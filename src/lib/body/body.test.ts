import {describe,it,expect,vi} from "vitest";
import {validateInput,validateCommand,validateCapabilities} from "./protocol";
import {BodyCore} from "./core";
import {VirtualBodyAdapter,DesktopBodyAdapter} from "./adapters";
import {reactionsFor} from "../character";
const event={version:1,type:"touch",bodyId:"virtual",timestamp:"2026-10-05T00:00:00Z",payload:{}};
describe("transport-safe body domain",()=>{
 it("rejects unknown types, versions, fields, payloads and oversized frames",()=>{
  expect(validateInput(event)).toBe(true);
  for(const v of [{...event,version:2},{...event,type:"shell"},{...event,payload:{path:"/etc"}},{...event,extra:true},{...event,timestamp:"bad"},{...event,bodyId:"../x"},{...event,type:"status",payload:{message:"x".repeat(5000)}}])expect(validateInput(v)).toBe(false);
  expect(validateCapabilities({inputs:["touch"],outputs:["expression"]})).toBe(true);expect(validateCapabilities({inputs:["touch","touch"],outputs:[]})).toBe(false);expect(validateCapabilities({inputs:["execute"],outputs:[]})).toBe(false);
  expect(validateCommand({version:1,type:"brightness",bodyId:"virtual",payload:{level:2}})).toBe(false);
  expect(validateCommand({version:1,type:"haptic",bodyId:"virtual",payload:{intensity:.2,durationMs:5000}})).toBe(false);
 });
 it("shares semantic reactions with desktop and virtual bodies, caches state, avoids duplicate expressions",async()=>{
  const core=new BodyCore(),virtual=new VirtualBodyAdapter(),render=vi.fn(),desktop=new DesktopBodyAdapter(render);await core.connect(virtual);await core.connect(desktop);
  core.react(reactionsFor("gentle_tap")[0]);await Promise.resolve();const count=virtual.commands.filter(c=>c.type==="expression").length;
  core.react(reactionsFor("gentle_tap")[0]);await Promise.resolve();expect(virtual.commands.filter(c=>c.type==="expression")).toHaveLength(count);expect(render).toHaveBeenCalled();
  await core.disconnect("virtual");expect(virtual.simulate("touch")).toBe(false);await core.connect(virtual);expect(virtual.commands.at(-1)?.type).toBe("expression");
  expect(core.diagnostics().find(s=>s.bodyId==="virtual")?.connected).toBe(true);
 });
 it("handles negotiated inputs, touch, low battery and disconnect while brain lives",async()=>{
  const core=new BodyCore(),virtual=new VirtualBodyAdapter(),observe=vi.fn();core.observe(observe);await core.connect(virtual);virtual.simulate("touch");await Promise.resolve();expect(observe).toHaveBeenCalledOnce();expect(virtual.commands.find(c=>c.payload.id==="pleased")).toBeDefined();
  virtual.simulate("battery",{percent:10});await Promise.resolve();expect(virtual.commands.find(c=>c.payload.id==="concerned")).toBeDefined();
  expect(core.input({...event,bodyId:"unpaired"})).toBe(false);expect(core.input({...event,version:9})).toBe(false);
  await core.disconnect("virtual");core.react(reactionsFor("task_succeeded")[0]);await core.connect(virtual);expect(virtual.commands.at(-1)?.payload.id).toBe("success");
 });
});

describe("body race hardening",()=>{
 it("invalidates delayed shake reactions when a newer task state arrives",async()=>{
  vi.useFakeTimers(); const core=new BodyCore(),body=new VirtualBodyAdapter();await core.connect(body);
  body.simulate("shake");core.react({expression:"success",intensity:.8,durationMs:10000});
  await vi.advanceTimersByTimeAsync(3000);
  expect(body.commands.filter(c=>c.type==="expression").at(-1)?.payload.id).toBe("success");
  core.dispose();await vi.advanceTimersByTimeAsync(20000);expect(body.simulate("touch")).toBe(false);vi.useRealTimers();
 });
 it("survives 200 reconnect cycles without duplicated input subscriptions",async()=>{
  const core=new BodyCore(),body=new VirtualBodyAdapter(),observer=vi.fn();core.observe(observer);
  for(let i=0;i<200;i++){await core.connect(body);body.simulate("touch");await core.disconnect(body.bodyId);}
  expect(observer).toHaveBeenCalledTimes(200);expect(core.diagnostics()).toHaveLength(1);core.dispose();
 });
});

it("disconnect during asynchronous handshake cannot resurrect a body",async()=>{
 const core=new BodyCore(),body=new VirtualBodyAdapter();let complete!:()=>void;
 body.connect=async()=>{await new Promise<void>(resolve=>complete=resolve);body.connected=true;};
 const connecting=core.connect(body);await Promise.resolve();await core.disconnect(body.bodyId);complete();await connecting;
 expect(core.diagnostics().some(s=>s.connected)).toBe(false);expect(body.connected).toBe(false);core.dispose();
});
