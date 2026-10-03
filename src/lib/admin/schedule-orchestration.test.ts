import assert from "node:assert/strict";
import test from "node:test";
import { generateScheduleOnWebsite } from "./schedule-orchestration";
const input = { origin: "https://schedule.example", accessToken: "test-session", runId: "run", periodId: "period" };
test("website generation sends authenticated IDs, not browser-supplied planning data", async () => {
 const result = await generateScheduleOnWebsite({...input, fetchImpl: async (url, init) => {
   assert.equal(String(url), "https://schedule.example/api/scheduling_engine");
   assert.equal((init?.headers as Record<string,string>).Authorization, "Bearer test-session");
   assert.deepEqual(JSON.parse(String(init?.body)), {generation_run_id:"run",period_id:"period"});
   return Response.json({ok:true,message:"Draft created"});
 }});
 assert.equal(result.ok,true);
});
test("an HTTP 200 login page is not mistaken for a completed draft", async () => {
 const result = await generateScheduleOnWebsite({...input,fetchImpl:async()=>new Response("<html>Sign in</html>")});
 assert.equal(result.ok,false);
});
test("backend failures are surfaced", async()=>{
 const result=await generateScheduleOnWebsite({...input,fetchImpl:async()=>Response.json({message:"Availability changed"},{status:409})});
 assert.deepEqual(result,{ok:false,message:"Availability changed"});
});
test("network errors do not leak tokens or internals",async()=>{
 const result=await generateScheduleOnWebsite({...input,fetchImpl:async()=>{throw new Error("private detail")}});
 assert.equal(result.ok,false);assert.ok(!result.message.includes("private"));
});
