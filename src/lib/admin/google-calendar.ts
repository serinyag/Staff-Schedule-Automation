import { createHash } from 'node:crypto';
export type CalendarShift = {id:string;shift_date:string;shift_type:string;start_time:string|null;end_time:string|null};
export function publishedCalendarEvent(periodId:string,shift:CalendarShift,names:string[]) {
 if (!names.length) return null;
 const dayAfter=new Date(`${shift.shift_date}T12:00:00Z`);dayAfter.setUTCDate(dayAfter.getUTCDate()+1);
 const tomorrow=dayAfter.toISOString().slice(0,10);
 const timed=!!shift.start_time && !!shift.end_time;
 const endDate=timed && shift.end_time!<=shift.start_time! ? tomorrow : shift.shift_date;
 const label=shift.shift_type[0].toUpperCase()+shift.shift_type.slice(1);
 return {id:'c'+createHash('sha256').update(`${periodId}:${shift.id}`).digest('hex'),
  summary:`${label}: ${[...new Set(names)].sort().join(', ')}`,
  description:'Published WNC staff schedule. Managed by the staff scheduling app.',
  start:timed?{dateTime:`${shift.shift_date}T${shift.start_time}`,timeZone:'Europe/Amsterdam'}:{date:shift.shift_date},
  end:timed?{dateTime:`${endDate}T${shift.end_time}`,timeZone:'Europe/Amsterdam'}:{date:tomorrow},
  extendedProperties:{private:{wncPeriod:periodId,wncShift:shift.id}},reminders:{useDefault:false}};
}
