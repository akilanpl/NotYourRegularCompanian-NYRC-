import {invoke,listen} from "../bridge/tauri";
import {validateCapabilities,validateInput,type BodyCapabilities,type BodyCommand,type BodyInputEvent} from "./protocol";
import type {BodyAdapter,BodyCore} from "./core";
/** TCP is confined to the backend; the domain core depends only on BodyAdapter. */
export class LocalTransportBodyAdapter implements BodyAdapter {
 private listeners=new Set<(e:BodyInputEvent)=>void>();
 constructor(readonly bodyId:string,private capabilities:BodyCapabilities){}
 async connect(){}async disconnect(){}
 getCapabilities(){return this.capabilities;}
 async send(command:BodyCommand){await invoke("send_body_command",{command});}
 subscribe(fn:(e:BodyInputEvent)=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 receive(event:BodyInputEvent){this.listeners.forEach(f=>f(event));}
}
export async function attachLocalTransport(core:BodyCore){
 const adapters=new Map<string,LocalTransportBodyAdapter>();
 const offConnection=await listen<{version:number;bodyId:string;connected:boolean;capabilities:BodyCapabilities}>("body:connection",state=>{
  if(state.version!==1||!validateCapabilities(state.capabilities)||["desktop","virtual"].includes(state.bodyId))return;
  if(state.connected){const a=new LocalTransportBodyAdapter(state.bodyId,state.capabilities);adapters.set(state.bodyId,a);void core.connect(a);}
  else{adapters.delete(state.bodyId);void core.disconnect(state.bodyId);}
 });
 const offInput=await listen<BodyInputEvent>("body:input",event=>{if(validateInput(event))adapters.get(event.bodyId)?.receive(event);});
 return ()=>{offConnection();offInput();for(const id of adapters.keys())void core.disconnect(id);};
}
