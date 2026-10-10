import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateNotes} from './candidate-notes';
test('candidate notes show same-day work and actual weekly target use', () => {
 const shifts = [10,11,12,14].map(d => ({id:String(d),shift_date:`2026-08-${d}`,shift_type:'morning'}));
 const context = {shifts,contracts:[{staff_id:'s',start_date:'2026-01-01',target_shifts_per_week:4,max_shifts_per_week:5}]};
 const notes = candidateNotes('s','2026-08-14','evening',context,shifts.map(s => ({staff_id:'s',shift_id:s.id})));
 assert.ok(notes.includes('Already working morning shift that day.'));
 assert.ok(notes.includes('Already scheduled for 4 shifts this week (target 4, maximum 5).'));
 assert.ok(notes.some(n=>n.startsWith('Weekly target reached.')));
 assert.ok(!notes.some(n=>n.startsWith('Weekly maximum reached.')));
});
test('notes count neighbouring month work and identify rest and weekend limits', () => {
 const notes = candidateNotes('s','2026-08-01','morning',{
 boundary_assignments:[{staff_id:'s',shift_date:'2026-07-31',shift_type:'evening'}],
 shifts:[{id:'sun',shift_date:'2026-08-02',shift_type:'morning'}],
 staff:[{id:'s',scheduling_rule_role:'core_team'}],role_rules:[{scheduling_rule_role:'core_team',raw:{block_full_weekend:true}}],settings:{block_evening_to_next_morning:true}
 },[{staff_id:'s',shift_id:'sun'}]);
 assert.ok(notes.includes('Already scheduled for 2 shifts this week.'));
 assert.ok(notes.some(n=>n.includes('rest rule')));
 assert.ok(notes.some(n=>n.includes('other weekend day')));
});
