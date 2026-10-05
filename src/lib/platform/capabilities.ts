import { invoke } from "../bridge/tauri";
export const CAPABILITIES = ["system.volume.read","system.volume.write","system.mute","system.media","system.focus","app.launch","web.open","clipboard.read","clipboard.write","desktop.notifications","secure.secrets","filesystem.pocket","calendar"] as const;
export type CapabilityId = typeof CAPABILITIES[number];
export type CapabilityStatus = "supported" | "unsupported" | "permission_required" | "temporarily_unavailable";
export type Capability = {id:CapabilityId;status:CapabilityStatus;reason:string};
export function actionCapability(action:string):CapabilityId|undefined {
 if(action==="system.volume.get")return "system.volume.read";
 if(/system.volume.(mute|unmute)$/.test(action))return "system.mute";
 if(action.startsWith("system.volume."))return "system.volume.write";
 if(action.startsWith("media."))return "system.media";
 if(/^system.(focus|dnd)/.test(action))return "system.focus";
 if(action==="app.open")return "app.launch";
 if(action==="web.open")return "web.open";
 if(action.startsWith("calendar."))return "calendar";
 if(action.startsWith("pocket."))return "filesystem.pocket";
 if(action==="clipboard.read"||action==="clipboard.to_pocket")return "clipboard.read";
 if(action==="clipboard.write")return "clipboard.write";
}
export class CapabilityRegistry {
 constructor(private load:()=>Promise<Capability[]> = ()=>invoke("get_platform_capabilities")){}
 async check(action:string):Promise<{code:string;message:string}|null>{
  const id=actionCapability(action);if(!id)return null;
  let capabilities:Capability[];try{capabilities=await this.load();}catch{return {code:"temporarily_unavailable",message:"Host capabilities are unavailable."};}
  const cap=capabilities.find(c=>c.id===id);
  if(!cap)return {code:"unsupported_capability",message:`${id} is unavailable.`};
  if(cap.status==="unsupported"||cap.status==="temporarily_unavailable")return {code:cap.status==="unsupported"?"unsupported_on_current_platform":cap.status,message:`${id}: ${cap.reason}`};
  // permission_required means TaskManager/OS approval remains mandatory, not unsupported.
  return null;
 }
}
