import {it,expect,vi} from "vitest";
import {CapabilityRegistry,actionCapability} from "./capabilities";
import {DesktopAssistantExecutor} from "../tasks/desktopAssistantExecutor";
import type {DesktopAssistantBackend} from "../tasks/desktopAssistantExecutor";
it("maps actions to a central capability and reports unknown or disconnected host",async()=>{expect(actionCapability("system.volume.set")).toBe("system.volume.write");expect(actionCapability("calendar.list")).toBe("calendar");expect(await new CapabilityRegistry(async()=>[]).check("web.open")).toMatchObject({code:"unsupported_capability"});expect(await new CapabilityRegistry(async()=>{throw Error();}).check("web.open")).toMatchObject({code:"temporarily_unavailable"});});
it("never invokes a known unsupported operation and modes retain partial success",async()=>{
 const volume=vi.fn(async()=>35),focus=vi.fn();const backend={getSystemVolume:volume,unsupportedDesktopCapability:focus,listModes:async()=>[{id:"m",name:"work",actions:[{id:"system.volume.get",payload:{},permission:"none"},{id:"system.focus.enable",payload:{},permission:"none"}]}]} as unknown as DesktopAssistantBackend;
 const registry=new CapabilityRegistry(async()=>[{id:"system.volume.read",status:"supported",reason:"tested"},{id:"system.focus",status:"unsupported",reason:"no adapter"}]);const executor=new DesktopAssistantExecutor(backend,registry);
 const result=await executor.execute({id:"mode.activate",payload:{name:"work"},permission:"none"});expect(result.ok&&result.data).toMatchObject({status:"partial_success"});expect(volume).toHaveBeenCalledOnce();expect(focus).not.toHaveBeenCalled();
});
