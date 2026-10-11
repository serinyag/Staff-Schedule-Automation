import {NextResponse} from 'next/server';
import {authorizedScheduleManager,readScheduleCommand} from '@/lib/server/schedule-http';
import {calendarReady,calendarConnection,calendarClient,writableCalendars,dispatchCalendarJobs} from '@/lib/server/google-calendar';
import {getSupabaseServiceRoleClient} from '@/lib/supabase/service';
import {isUuid} from '@/lib/admin/schedule-commands';
export async function GET(request:Request){
 const auth=await authorizedScheduleManager();if(auth.status!==200)return NextResponse.json({message:auth.message},{status:auth.status});
 try{const connection=await calendarConnection();const periodId=new URL(request.url).searchParams.get('periodId');
  const db=getSupabaseServiceRoleClient();const {data:job}=periodId&&isUuid(periodId)?await db.from('google_calendar_jobs').select('status,error_message,synced_at').eq('period_id',periodId).eq('calendar_id',connection?.calendar_id||'').maybeSingle():{data:null};
  let calendars:{id:string;name:string}[]=[];let connectionError:string|null=null;
  if(connection&&calendarReady()){try{calendars=await writableCalendars(await calendarClient(connection));}catch{connectionError='Google access needs attention. Reconnect Google; you can pause sync meanwhile.';}}
  return NextResponse.json({ready:calendarReady(),connected:!!connection,calendarId:connection?.calendar_id||'',autoSync:connection?.auto_sync||false,calendars,job,connectionError},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({message:'Calendar settings could not be loaded. Reconnect Google or try again.'},{status:503});}
}
export async function POST(request:Request){
 const auth=await authorizedScheduleManager();if(auth.status!==200)return NextResponse.json({message:auth.message},{status:auth.status});
 try{const body=await readScheduleCommand(request) as {action?:string;calendarId?:string;autoSync?:boolean;periodId?:string};const db=getSupabaseServiceRoleClient();
  if(body.action==='pause'){const {error}=await db.from('google_calendar_connection').update({auto_sync:false,updated_at:new Date().toISOString()}).eq('singleton',true);if(error)throw error;return NextResponse.json({message:'Calendar sync paused.'});}
  const connection=await calendarConnection();if(!connection||!calendarReady())return NextResponse.json({message:'Connect Google first.'},{status:409});
  if(body.action==='save'){
   if(typeof body.calendarId!=='string'||typeof body.autoSync!=='boolean')return NextResponse.json({message:'Choose a calendar and sync option.'},{status:400});
   const calendar=(await writableCalendars(await calendarClient(connection))).find(c=>c.id===body.calendarId);if(!calendar)return NextResponse.json({message:'Choose a Google calendar you can edit.'},{status:400});
   const {error}=await db.from('google_calendar_connection').update({calendar_id:calendar.id,calendar_name:calendar.name,auto_sync:body.autoSync,updated_at:new Date().toISOString()}).eq('singleton',true);if(error)throw error;
   return NextResponse.json({message:body.autoSync?'Future published schedules will sync to this calendar.':'Calendar saved. Automatic sync is off.'});
  }
  if(body.action==='retry'&&body.periodId&&isUuid(body.periodId)){
   if(!connection.auto_sync||!connection.calendar_id)return NextResponse.json({message:'Enable calendar sync first.'},{status:409});
   const {data:period}=await db.from('schedule_periods').select('status').eq('id',body.periodId).single();if(!period||!['published','locked'].includes(period.status))return NextResponse.json({message:'Only published schedules can sync.'},{status:409});
   const {data:job}=await db.from('google_calendar_jobs').select('id,status').eq('period_id',body.periodId).eq('calendar_id',connection.calendar_id).maybeSingle();
   if(job?.status==='syncing')return NextResponse.json({message:'Sync is already in progress.'},{status:409});
   if(job?.status==='synced')return NextResponse.json({message:'This schedule is already synced.'});
   const {error}=await db.from('google_calendar_jobs').upsert({period_id:body.periodId,calendar_id:connection.calendar_id,status:'queued',attempts:0},{onConflict:'period_id,calendar_id'});if(error)throw error;
   await dispatchCalendarJobs(body.periodId);return NextResponse.json({message:'Published schedule queued for calendar sync.'});
  }
  return NextResponse.json({message:'Invalid calendar action.'},{status:400});
 }catch{return NextResponse.json({message:'Calendar settings could not be saved. Try again.'},{status:503});}
}
