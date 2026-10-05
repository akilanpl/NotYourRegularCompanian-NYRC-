import { reactionsFor, reactionForInteraction, type Reaction } from "../character";
import { validateInput, validateCommand, validateCapabilities, BODY_VERSION, type BodyInputEvent, type BodyCommand, type BodyCapabilities } from "./protocol";
export interface BodyAdapter {readonly bodyId:string;connect():Promise<void>;disconnect():Promise<void>;getCapabilities():BodyCapabilities;send(command:BodyCommand):Promise<void>;subscribe(listener:(event:BodyInputEvent)=>void):()=>void;}
export type BodyStatus={bodyId:string;version:number;capabilities:BodyCapabilities;connected:boolean;batteryPercent?:number;lastEvent?:string;lastError?:string};
export class BodyCore {
 private sequenceTimers = new Set<ReturnType<typeof setTimeout>>();
 private cancelSequence(){for(const timer of this.sequenceTimers)clearTimeout(timer);this.sequenceTimers.clear();}
 dispose(){this.cancelSequence();if(this.resetTimer)clearTimeout(this.resetTimer);for(const off of this.subscriptions.values())off();for(const adapter of this.adapters.values())void adapter.disconnect();this.adapters.clear();this.subscriptions.clear();this.listeners.clear();this.inputListeners.clear();this.taps.clear();this.sent.clear();this.statuses.clear();this.lifecycle.clear();}
 private lifecycle=new Map<string,number>();private nextLifecycle=0;
 private resetTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(){this.cached.set("expression",{version:1,type:"expression",bodyId:"cached",payload:{id:"neutral",intensity:.2,durationMs:900}});}
 private adapters=new Map<string,BodyAdapter>();private subscriptions=new Map<string,()=>void>();private statuses=new Map<string,BodyStatus>();private cached=new Map<string,BodyCommand>();private sent=new Map<string,string>();private taps=new Map<string,{count:number;at:number}>();private listeners=new Set<()=>void>();private inputListeners=new Set<(e:BodyInputEvent)=>void>();
 subscribe(fn:()=>void){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}private changed(){this.listeners.forEach(f=>f());}
 observe(fn:(e:BodyInputEvent)=>void){this.inputListeners.add(fn);return ()=>this.inputListeners.delete(fn);}
 diagnostics(){return [...this.statuses.values()].map(s=>({...s}));}
 async connect(adapter:BodyAdapter){
  if(!validateCapabilities(adapter.getCapabilities()))throw Error("Invalid body capabilities");
  const generation=++this.nextLifecycle;this.lifecycle.set(adapter.bodyId,generation);
  const previous=this.adapters.get(adapter.bodyId);this.subscriptions.get(adapter.bodyId)?.();this.subscriptions.delete(adapter.bodyId);this.adapters.delete(adapter.bodyId);
  await previous?.disconnect();
  if(this.lifecycle.get(adapter.bodyId)!==generation)return;
  await adapter.connect();
  if(this.lifecycle.get(adapter.bodyId)!==generation){await adapter.disconnect();return;}
  this.adapters.set(adapter.bodyId,adapter);
  this.statuses.set(adapter.bodyId,{bodyId:adapter.bodyId,version:BODY_VERSION,capabilities:adapter.getCapabilities(),connected:true});
  this.subscriptions.set(adapter.bodyId,adapter.subscribe(e=>this.input(e)));
  for(const c of this.cached.values()) {if(this.lifecycle.get(adapter.bodyId)!==generation)return;await this.send({...c,bodyId:adapter.bodyId},true);}
  this.changed();
 }
 async disconnect(id:string){this.lifecycle.delete(id);const adapter=this.adapters.get(id);this.adapters.delete(id);this.subscriptions.get(id)?.();this.subscriptions.delete(id);const s=this.statuses.get(id);if(s){s.connected=false;s.lastEvent="disconnected";}this.taps.delete(id);for(const k of this.sent.keys())if(k.startsWith(`${id}:`))this.sent.delete(k);const inactive=[...this.statuses.values()].filter(s=>!s.connected);for(const old of inactive.slice(0,Math.max(0,inactive.length-16)))this.statuses.delete(old.bodyId);this.changed();await adapter?.disconnect();}

 input(event:unknown){
  if(!validateInput(event)){return false;}const s=this.statuses.get(event.bodyId);if(!s?.connected||!s.capabilities.inputs.includes(event.type)){if(s)s.lastError="Unnegotiated input";this.changed();return false;}
  s.lastEvent=event.type;s.lastError=undefined;if(event.type==="battery")s.batteryPercent=Number(event.payload.percent);
  if(event.type==="sleep"||event.type==="wake")for(const bodyId of this.adapters.keys())void this.send({version:1,type:event.type,bodyId,payload:{}});this.inputListeners.forEach(f=>f(event));
  let reactions:readonly Reaction[]=[];
  if(["touch","double_tap","hold","button"].includes(event.type)){const now=Date.now();const previous=this.taps.get(event.bodyId);const count=previous&&now-previous.at<3000?previous.count+1:1;this.taps.set(event.bodyId,{count,at:now});reactions=[reactionForInteraction(count)];}
  else if(event.type==="shake")reactions=reactionsFor("shake");
  else if(event.type==="pickup"||event.type==="ready"||event.type==="wake")reactions=reactionsFor("user_returned");
  else if(event.type==="put_down")reactions=[{...reactionsFor("gentle_tap")[0],gesture:"settle"}];
  else if(event.type==="connection" && event.payload.online===false)reactions=reactionsFor("offline");
  else if(event.type==="sleep")reactions=[{expression:"sleeping",intensity:.2,durationMs:1200}];
  else if(event.type==="battery"&&Number(event.payload.percent)<20)reactions=reactionsFor("low_battery");
  // Gesture sequences are queued, never streamed as display frames.
  this.cancelSequence();
  let offset=0;for(const reaction of reactions){if(offset===0)this.react(reaction,true);else {const timer=setTimeout(()=>{this.sequenceTimers.delete(timer);this.react(reaction,true);},offset);this.sequenceTimers.add(timer);}offset+=reaction.durationMs;}
  this.changed();return true;
 }
 react(reaction:Reaction, sequence=false){
  if(!sequence)this.cancelSequence();
  if(this.resetTimer)clearTimeout(this.resetTimer);
  this.resetTimer=setTimeout(()=>{
   const command:BodyCommand={version:1,type:"expression",bodyId:"cached",payload:{id:"neutral",intensity:.2,durationMs:900}};
   this.cached.set("expression",command);for(const bodyId of this.adapters.keys())void this.send({...command,bodyId});
  },reaction.durationMs);
  const commands:Omit<BodyCommand,"bodyId">[]=[{version:1,type:"expression",payload:{id:reaction.expression,intensity:reaction.intensity,durationMs:reaction.durationMs}}];
  if(reaction.signal&&["offline","error","low_battery","reconnecting"].includes(reaction.signal))commands.push({version:1,type:"status_indicator",payload:{state:reaction.signal==="reconnecting"?"connected":reaction.signal}});
  if(reaction.gesture)commands.push({version:1,type:"animation",payload:{id:reaction.gesture}});
  if(reaction.message)commands.push({version:1,type:"text",payload:{text:reaction.message.slice(0,512)}});
  if(reaction.soundCue)commands.push({version:1,type:"sound",payload:{id:reaction.soundCue}});
  for(const command of commands){if(command.type==="expression"||command.type==="text")this.cached.set(command.type,{...command,bodyId:"cached"});for(const bodyId of this.adapters.keys())void this.send({...command,bodyId});}
 }
 async send(command:BodyCommand,force=false){
  if(!validateCommand(command))throw Error("Invalid body command");const a=this.adapters.get(command.bodyId);const s=this.statuses.get(command.bodyId);if(!a||!s?.connected)return;
  if(!s.capabilities.outputs.includes(command.type)){s.lastError=`Unsupported output: ${command.type}`;this.changed();return;}
  const key=`${command.bodyId}:${command.type}`,serialized=JSON.stringify(command.payload);
  if(!force&&["expression","brightness","status_indicator"].includes(command.type)&&this.sent.get(key)===serialized)return;
  this.sent.set(key,serialized);
  try{await a.send(command);}catch{this.sent.delete(key);s.lastError="Body send failed";}this.changed();
 }
}
