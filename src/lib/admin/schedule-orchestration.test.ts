import assert from "node:assert/strict";
import test from "node:test";
import { reviewScheduleOnWebsite } from "./schedule-orchestration";
const input = {origin:"https://schedule.example",accessToken:"private-session",periodId:"period"};
test("publication asks the authenticated engine to validate the saved draft, without supplied assignments",async()=>{
 const result=await reviewScheduleOnWebsite({...input,publish:true,fetchImpl:async(url,init)=>{
  assert.equal(String(url),"https://schedule.example/api/scheduling_engine");
  assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer private-session");
  assert.deepEqual(JSON.parse(String(init?.body)),{action:"publish",period_id:"period"});
  return Response.json({ok:true,ready:true,message:"Published"});
 }});assert.equal(result.ok,true);
});
test("blocking validation does not look like a successful publication",async()=>{
 const result=await reviewScheduleOnWebsite({...input,fetchImpl:async()=>Response.json({ok:true,ready:false,message:"Resolve blocking issues"})});
 assert.equal(result.ok,false);
});
test("HTML login responses and network failures are handled safely",async()=>{
 for (const fetchImpl of [async()=>new Response("<html>login</html>"),async()=>{throw new Error("private-session");}]) {
  const result=await reviewScheduleOnWebsite({...input,fetchImpl});assert.equal(result.ok,false);assert.ok(!result.message.includes("private-session"));
 }
});
test("stale draft conflicts are surfaced",async()=>{
 const result=await reviewScheduleOnWebsite({...input,fetchImpl:async()=>Response.json({message:"Draft changed"},{status:409})});
 assert.deepEqual(result,{ok:false,message:"Draft changed"});
});
