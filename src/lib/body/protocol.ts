import { COMPANION_EXPRESSIONS, CHARACTER_GESTURES, REACTION_SOUND_CUES } from "../character";
export const BODY_VERSION=1;
export const INPUT_TYPES=["touch","hold","double_tap","shake","pickup","put_down","button","voice_event","connection","battery","status","ready","sleep","wake"] as const;
export const OUTPUT_TYPES=["expression","animation","text","sound","speech_request","haptic","brightness","status_indicator","sleep","wake"] as const;
export type InputType=typeof INPUT_TYPES[number];export type OutputType=typeof OUTPUT_TYPES[number];
export type BodyInputEvent={version:1;type:InputType;bodyId:string;timestamp:string;payload:Record<string,unknown>};
export type BodyCommand={version:1;type:OutputType;bodyId:string;correlationId?:string;payload:Record<string,unknown>};
export type BodyCapabilities={inputs:InputType[];outputs:OutputType[]};
const id=(v:unknown)=>typeof v==="string"&&/^[a-zA-Z0-9_-]{1,64}$/.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const bounded=(v:unknown,min:number,max:number)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max;
const text=(v:unknown)=>typeof v==="string"&&v.length<=512;
export function validateCapabilities(v:unknown):v is BodyCapabilities {return record(v)&&keys(v,["inputs","outputs"])&&Array.isArray(v.inputs)&&Array.isArray(v.outputs)&&v.inputs.length<=INPUT_TYPES.length&&v.outputs.length<=OUTPUT_TYPES.length&&new Set(v.inputs).size===v.inputs.length&&new Set(v.outputs).size===v.outputs.length&&v.inputs.every(t=>INPUT_TYPES.includes(t))&&v.outputs.every(t=>OUTPUT_TYPES.includes(t));}
function size(v:unknown){try{return new TextEncoder().encode(JSON.stringify(v)).length<=4096;}catch{return false;}}
export function validateInput(v:unknown):v is BodyInputEvent {
 if(!size(v)||!record(v)||!keys(v,["version","type","bodyId","timestamp","payload"])||v.version!==1||!id(v.bodyId)||!INPUT_TYPES.includes(v.type as InputType)||typeof v.timestamp!=="string"||v.timestamp.length>40||!Number.isFinite(Date.parse(v.timestamp))||!record(v.payload))return false;
 const p=v.payload;
 switch(v.type){case "touch":case "hold":case "double_tap":case "shake":case "pickup":case "put_down":case "ready":case "sleep":case "wake":return keys(p,[]);
 case "battery":return keys(p,["percent","charging"])&&bounded(p.percent,0,100)&&(p.charging===undefined||typeof p.charging==="boolean");
 case "connection":return keys(p,["online"])&&typeof p.online==="boolean";
 case "button":return keys(p,["button"])&&id(p.button);
 case "voice_event":return keys(p,["state"])&&["started","stopped"].includes(String(p.state));
 case "status":return keys(p,["message"])&&text(p.message);default:return false;}
}
export function validateCommand(v:unknown):v is BodyCommand {
 if(!size(v)||!record(v)||!keys(v,["version","type","bodyId","correlationId","payload"])||v.version!==1||!id(v.bodyId)||(v.correlationId!==undefined&&!id(v.correlationId))||!OUTPUT_TYPES.includes(v.type as OutputType)||!record(v.payload))return false;
 const p=v.payload;
 switch(v.type){case "expression":return keys(p,["id","intensity","durationMs"])&&COMPANION_EXPRESSIONS.includes(p.id as any)&&bounded(p.intensity,0,1)&&Number.isInteger(p.durationMs)&&bounded(p.durationMs,1,60000);
 case "animation":return keys(p,["id"])&&CHARACTER_GESTURES.includes(p.id as any);
 case "sound":return keys(p,["id"])&&REACTION_SOUND_CUES.includes(p.id as any);
 case "text":case "speech_request":return keys(p,["text"])&&text(p.text);
 case "haptic":return keys(p,["intensity","durationMs"])&&bounded(p.intensity,0,1)&&Number.isInteger(p.durationMs)&&bounded(p.durationMs,1,1000);
 case "brightness":return keys(p,["level"])&&bounded(p.level,0,1);
 case "status_indicator":return keys(p,["state"])&&["idle","connected","offline","error","low_battery"].includes(String(p.state));
 case "sleep":case "wake":return keys(p,[]);default:return false;}
}
