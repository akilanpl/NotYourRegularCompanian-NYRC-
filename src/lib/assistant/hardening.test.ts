import {describe,it,expect} from "vitest";
import {estimateState} from "./state";
import {validateProposal} from "./proposals";
import {AssistantRuntime} from "./runtime";
import {TimerService} from "../tasks/timerService";
import {actionSuccess} from "../tasks/action";
import {CalendarProactivity,MockCalendarProvider} from "./calendar";

describe("adversarial assistant boundaries",()=>{
 it("keeps estimates finite under hostile numeric signals",()=>{
  for(const n of [NaN,Infinity,-Infinity,-1e20,1e20]){
   const state=estimateState({hour:n,successes:n,failures:n,interactions:n,body:{shakes:n,pickups:n,absence:false},manual:{focus:n}});
   for(const v of Object.values(state.dimensions))expect(Number.isFinite(v)&&v>=0&&v<=1).toBe(true);
   expect(state.confidence).toBeLessThanOrEqual(.85);
  }
 });
 it("rejects unknown, oversized and permission-forging model proposals",()=>{
  for(const proposal of [{kind:"action",action:"shell.execute",payload:{}},{kind:"action",action:"web.open",payload:{url:"javascript:alert(1)"}},{kind:"action",action:"pocket.save_text",payload:{title:"x",content:"x".repeat(2001)}},{kind:"action",action:"calendar.delete",payload:{id:"a",permission:"none"}}])expect(validateProposal(proposal)).toBeNull();
 });
 it("routes fake AI through task permission once, with no malicious side effects",async()=>{
  let executed=0;let proposal:unknown={kind:"action",action:"pocket.save_text",payload:{title:"Test",content:"<script>alert(1)</script>"}};
  const runtime=new AssistantRuntime(new TimerService(),async()=>proposal,[{canExecute:()=>true,execute:async()=>{executed++;return actionSuccess({saved:true});}}]);
  const result=await runtime.submit("ambiguous useful request");expect(result.task?.status).toBe("permission_required");expect(executed).toBe(0);
  await runtime.permission(result.task!.id,true);expect(executed).toBe(1);
  await expect(runtime.permission(result.task!.id,true)).rejects.toThrow();
  proposal={kind:"action",action:"shell.execute",payload:{command:"unsafe"}};await runtime.submit("another ambiguous request");expect(executed).toBe(1);
 });
 it("detects overlap across offsets and all-day dates without flagging adjacent events",async()=>{
  const provider=new MockCalendarProvider();const title="<script>external data</script>";
  const a=await provider.create({title,start:"2026-10-05T10:00:00Z",end:"2026-10-05T11:00:00Z",timezone:"UTC"});
  const adjacent=await provider.create({title:"adjacent",start:a.end,end:"2026-10-05T12:00:00Z",timezone:"UTC"});
  const b=await provider.create({title:"overlap",start:"2026-10-05T16:00:00+05:30",end:"2026-10-05T16:30:00+05:30",timezone:"Asia/Kolkata"});
  const messages:string[]=[];const p=new CalendarProactivity(m=>messages.push(m));p.load([a,adjacent,b],Date.parse("2027-01-01"));
  expect(messages).toHaveLength(1);p.load([a,adjacent,b],Date.parse("2027-01-01"));expect(messages).toHaveLength(1);
  await provider.update({...a,title:"updated"});expect((await provider.get(a.id)).title).toBe("updated");await provider.delete(a.id);await expect(provider.get(a.id)).rejects.toThrow();p.dispose();
 });
});
