import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedCalendarEvent} from './google-calendar';
const shift={id:'shift-1',shift_date:'2026-10-25',shift_type:'evening',start_time:'22:00:00',end_time:'02:00:00'};
test('calendar event is stable across retries and lists staff only once',()=>{const a=publishedCalendarEvent('period',shift,['Lilly','Bella','Lilly'])!;const b=publishedCalendarEvent('period',shift,['Bella','Lilly'])!;assert.deepEqual(a,b);assert.match(a.id,/^[a-v0-9]{5,1024}$/);assert.equal(a.summary,'Evening: Bella, Lilly');assert.equal(a.start.timeZone,'Europe/Amsterdam');assert.equal(a.end.dateTime,'2026-10-26T02:00:00');assert.equal(a.extendedProperties.private.wncShift,'shift-1');assert.ok(!('attendees' in a));});
test('unassigned optional shifts produce no event',()=>assert.equal(publishedCalendarEvent('p',shift,[]),null));
test('a shift without times uses an exclusive all-day end date',()=>{const a=publishedCalendarEvent('p',{...shift,shift_date:'2026-12-31',start_time:null,end_time:null},['Haylin'])!;assert.deepEqual(a.start,{date:'2026-12-31'});assert.deepEqual(a.end,{date:'2027-01-01'});});
