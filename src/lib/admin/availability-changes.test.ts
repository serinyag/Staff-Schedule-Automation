import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findAvailabilityChanges, type SubmittedAvailabilityRevision} from './availability-changes';
const row = (id:string,time:string,available=true,kind='submitted'):SubmittedAvailabilityRevision => ({id,staff_id:'staff',kind,created_at:time,daily_availability:[{available_date:'2026-11-01',morning:available,day:true,evening:true}],willing_to_work_above_target:false,max_extra_shifts_for_period:0});
const before='2026-10-01T00:00:00Z', reviewed='2026-10-02T00:00:00Z',after='2026-10-03T00:00:00Z';
test('only changed effective resubmissions need attention',()=>{
 assert.deepEqual(findAvailabilityChanges([row('a',before),row('b',after)],reviewed),[]);
 assert.deepEqual(findAvailabilityChanges([row('a',before),row('b',after,false,'draft')],reviewed),[]);
 assert.deepEqual(findAvailabilityChanges([row('b',after,false)],reviewed),[]);
 assert.deepEqual(findAvailabilityChanges([row('a',before),row('b',after,false)],reviewed),[{staffId:'staff',revisionId:'b'}]);
 assert.deepEqual(findAvailabilityChanges([row('a',before),row('b',after,false)],after),[]);
 assert.deepEqual(findAvailabilityChanges([row('a',before)],null),[]);
});
test('restoring the original availability clears the warning',()=>{
 assert.deepEqual(findAvailabilityChanges([row('a',before),row('b',after,false),row('c','2026-10-04T00:00:00Z')],reviewed),[]);
});

test('identical resubmission does not create another notification',()=>{
 assert.deepEqual(findAvailabilityChanges([row('a',before),row('b',after,false),row('c','2026-10-04T00:00:00Z',false)],reviewed),[{staffId:'staff',revisionId:'b'}]);
});
