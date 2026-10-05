import { reactionsFor, reactionForInteraction, type Reaction } from "../character";
import { validateInput, validateCommand, validateCapabilities, BODY_VERSION, type BodyInputEvent, type BodyCommand, type BodyCapabilities } from "./protocol";
export interface BodyAdapter {readonly bodyId:string;connect():Promise<void>;disconnect():Promise<void>;getCapabilities():BodyCapabilities;send(command:BodyCommand):Promise<void>;subscribe(listener:(event:BodyInputEvent)=>void):()=>void;}
export type BodyStatus={bodyId:string;version:number;capabilities:BodyCapabilities;connected:boolean;batteryPercent?:number;lastEvent?:string;lastError?:string};
export class BodyCore {
 private resetTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(){this.cached.set("expression",{version:1,type:"expression",bodyId:"cached",payload:{id:"neutral",intensity:.2,durationMs:900}});}
 private adapters=new Map<string,BodyAdapter>();private subscriptions=new Map<string,()=>void>();private statuses=new Map<string,BodyStatus>();private cached=new Map<string,BodyCommand>();private sent=new Map<string,string>();private taps=new Map<string,{count:number;at:number}>();private listeners=new Set<()=>void>();private inputListeners=new Set<(e:BodyInputEvent)=>void>();
 subscribe(fn:()=>void){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}private changed(){this.listeners.forEach(f=>f());}
 observe(fn:(e:BodyInputEvent)=>void){this.inputListeners.add(fn);return ()=>this.inputListeners.delete(fn);}
 diagnostics(){return [...this.statuses.values()].map(s=>({...s}));}
 async connect(adapter:BodyAdapter){
  if(!validateCapabilities(adapter.getCapabilities()))throw Error("Invalid body capabilities");
  if(this.adapters.has(adapter.bodyId))await this.disconnect(adapter.bodyId);
  await adapter.connect();this.adapters.set(adapter.bodyId,adapter);
  this.statuses.set(adapter.bodyId,{bodyId:adapter.bodyId,version:BODY_VERSION,capabilities:adapter.getCapabilities(),connected:true});
  this.subscriptions.set(adapter.bodyId,adapter.subscribe(e=>this.input(e)));
  for(const c of this.cached.values())await this.send({...c,bodyId:adapter.bodyId},true);
  this.changed();
 }
 async disconnect(id:string){const adapter=this.adapters.get(id);this.subscriptions.get(id)?.();this.subscriptions.delete(id);await adapter?.disconnect();this.adapters.delete(id);const s=this.statuses.get(id);if(s){s.connected=false;s.lastEvent="disconnected";}for(const k of this.sent.keys())if(k.startsWith(`${id}:`))this.sent.delete(k);this.changed();}
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
  let offset=0;for(const reaction of reactions){if(offset===0)this.react(reaction);else setTimeout(()=>this.react(reaction),offset);offset+=reaction.durationMs;}
  this.changed();return true;
 }
 react(reaction:Reaction){
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
