import assert from "node:assert/strict";
import test from "node:test";
import {isAssignmentCommand,isDayShiftCommand} from "./schedule-commands";
const id="11111111-1111-4111-8111-111111111111";
test("assignment commands require valid IDs and recognized actions",()=>{
 assert.ok(isAssignmentCommand({action:"assign",periodId:id,staffId:id,shiftId:id}));
 assert.ok(isAssignmentCommand({action:"move",periodId:id,assignmentId:id,targetShiftId:id}));
 assert.ok(!isAssignmentCommand({action:"remove",periodId:id,assignmentId:"other-period?"}));
 assert.ok(!isAssignmentCommand({action:"publish",periodId:id}));
});
test("optional shifts require real calendar dates",()=>{
 assert.ok(isDayShiftCommand({action:"create",periodId:id,dateKey:"2026-08-31",shiftType:"day"}));
 assert.ok(!isDayShiftCommand({action:"create",periodId:id,dateKey:"2026-02-30",shiftType:"day"}));
 assert.ok(!isDayShiftCommand({action:"create",periodId:id,dateKey:"2026-08-31",shiftType:"evening"}));
});
