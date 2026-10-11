import assert from "node:assert/strict";
import test from "node:test";
import { monthlyAvailabilityWindow } from "./monthly-window";
test("next month opens at Amsterdam midnight, including UTC month boundary",()=>{
 assert.deepEqual(monthlyAvailabilityWindow(new Date("2026-10-31T23:00:00Z")),{today:"2026-11-01",nextMonthStart:"2026-12-01"});
 assert.deepEqual(monthlyAvailabilityWindow(new Date("2026-10-31T22:59:59Z")),{today:"2026-10-31",nextMonthStart:"2026-11-01"});
});
test("year rollover is correct",()=>{
 assert.equal(monthlyAvailabilityWindow(new Date("2026-12-12T12:00:00Z")).nextMonthStart,"2027-01-01");
});
