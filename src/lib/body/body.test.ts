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
