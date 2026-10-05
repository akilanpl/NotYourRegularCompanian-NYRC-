import { INPUT_TYPES, OUTPUT_TYPES, validateCommand, validateInput, type BodyInputEvent, type BodyCommand, type BodyCapabilities, type InputType } from "./protocol";
import type { BodyAdapter } from "./core";
export class VirtualBodyAdapter implements BodyAdapter {
 private listeners=new Set<(e:BodyInputEvent)=>void>();connected=false;commands:BodyCommand[]=[];
 constructor(readonly bodyId="virtual"){}
 async connect(){this.connected=true;}async disconnect(){this.connected=false;}
 getCapabilities():BodyCapabilities{return {inputs:[...INPUT_TYPES],outputs:[...OUTPUT_TYPES]};}
 async send(command:BodyCommand){if(!this.connected||command.bodyId!==this.bodyId||!validateCommand(command))throw Error("Rejected body command");this.commands=[...this.commands.slice(-39),command];}
 subscribe(fn:(e:BodyInputEvent)=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 simulate(type:InputType,payload:Record<string,unknown>={}){const event:BodyInputEvent={version:1,type,bodyId:this.bodyId,timestamp:new Date().toISOString(),payload};if(!this.connected||!validateInput(event))return false;this.listeners.forEach(f=>f(event));return true;}
}
export class DesktopBodyAdapter extends VirtualBodyAdapter {
 constructor(private render:(command:BodyCommand)=>void){super("desktop");}
 override getCapabilities():BodyCapabilities{return {inputs:[...INPUT_TYPES],outputs:["expression","animation","text","sound","sleep","wake","status_indicator"]};}
 override async send(command:BodyCommand){await super.send(command);this.render(command);}
}
