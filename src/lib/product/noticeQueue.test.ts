import {describe,it,expect} from "vitest";
import {NoticeQueue} from "./noticeQueue";
describe("bounded alert delivery",()=>{
 it("preserves same-priority alerts and preempts low priority",()=>{
  const q=new NoticeQueue();q.push({key:"low",message:"idle",priority:1,at:0});
  q.push({key:"alarm1",message:"alarm one",priority:3,at:1});q.push({key:"alarm2",message:"alarm two",priority:3,at:2});
  expect(q.active?.key).toBe("alarm1");expect(q.dismiss()?.key).toBe("alarm2");expect(q.dismiss()?.key).toBe("low");expect(q.dismiss()).toBeNull();
 });
 it("coalesces duplicates, bounds storms and surfaces critical overflow",()=>{
  const q=new NoticeQueue();for(let i=0;i<100;i++)q.push({key:`low${i}`,message:"idle",priority:1,at:i});
  for(let i=0;i<100;i++)q.push({key:`alarm${i}`,message:"alarm",priority:3,at:100+i});
  q.push({key:"alarm0",message:"duplicate",priority:3,at:999});expect(q.size).toBeLessThanOrEqual(32);
  const shown:string[]=[];while(q.active){shown.push(q.active.message);q.dismiss();}
  expect(shown.some(s=>s.includes("more alerts"))).toBe(true);expect(shown.filter(s=>s==="duplicate")).toHaveLength(0);
 });
});
