import {it,expect} from "vitest";
import {serviceRequestId} from "./tauri";
it("generates cancellation IDs without depending on WebKit randomUUID availability",()=>{
 const id=serviceRequestId({getRandomValues:<T extends ArrayBufferView|null>(array:T)=>{(array as Uint8Array).fill(255);return array;}});
 expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
});
