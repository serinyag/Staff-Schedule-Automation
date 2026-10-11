import assert from "node:assert/strict";
import test from "node:test";
import {readScheduleCommand} from "./schedule-http-guard";
function request(body:string,origin="https://schedule.example",contentType="application/json") {
 return new Request("https://schedule.example/api/admin/schedule/assignments",{method:"POST",body,headers:{origin,"content-type":contentType}});
}
test("same-origin JSON commands are accepted",async()=>{
 assert.deepEqual(await readScheduleCommand(request('{"action":"remove"}')),{action:"remove"});
});
test("cross-origin, missing-origin and non-JSON mutations are rejected",async()=>{
 for(const r of [request('{}','https://other.example'),request('{}',''),request('{}','https://schedule.example','text/plain')]) {
  await assert.rejects(readScheduleCommand(r));
 }
});
test("oversized streamed bodies and malformed JSON fail without calling the database",async()=>{
 await assert.rejects(readScheduleCommand(request('"'+"x".repeat(5000)+'"')),/size/);
 await assert.rejects(readScheduleCommand(request('{not json}')));
});
