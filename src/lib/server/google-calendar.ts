import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {send} from '@vercel/queue';
import {getSupabaseServiceRoleClient} from '@/lib/supabase/service';
import {scheduleAppOrigin} from './schedule-worker';
import {publishedCalendarEvent} from '@/lib/admin/google-calendar';
export function calendarReady() {
 return !!process.env.GOOGLE_CALENDAR_CLIENT_ID && !!process.env.GOOGLE_CALENDAR_CLIENT_SECRET && /^[a-f0-9]{64}$/i.test(process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY||'');
}
export function googleOAuth() {
 if(!calendarReady()) throw new Error('Google Calendar setup is not complete.');
 return new OAuth2Client(process.env.GOOGLE_CALENDAR_CLIENT_ID,process.env.GOOGLE_CALENDAR_CLIENT_SECRET,new URL('/api/admin/calendar/callback',scheduleAppOrigin()).href);
}
function key(){return Buffer.from(process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY!,'hex');}
export function encryptCalendarToken(token:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
function decryptToken(value:string){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}
export async function calendarConnection(){const {data,error}=await getSupabaseServiceRoleClient().from('google_calendar_connection').select('*').maybeSingle();if(error)throw new Error('Calendar settings unavailable.');return data;}
export async function calendarClient(connection:NonNullable<Awaited<ReturnType<typeof calendarConnection>>>){const client=googleOAuth();client.setCredentials({refresh_token:decryptToken(connection.refresh_token_ciphertext)});return client;}
export async function writableCalendars(client:OAuth2Client){let pageToken:string|undefined;const items:{id:string;name:string}[]=[];do{const r=await client.request<{items?:{id:string;summary:string;accessRole:string}[];nextPageToken?:string}>({url:'https://www.googleapis.com/calendar/v3/users/me/calendarList',params:{pageToken,minAccessRole:'writer',maxResults:250},timeout:15000});items.push(...(r.data.items||[]).filter(c=>['writer','owner'].includes(c.accessRole)).map(c=>({id:c.id,name:c.summary})));pageToken=r.data.nextPageToken;}while(pageToken);return items;}
export async function dispatchCalendarJobs(periodId:string){const db=getSupabaseServiceRoleClient();const {data,error}=await db.from('google_calendar_jobs').select('id').eq('period_id',periodId).in('status',['queued','failed']).lt('attempts',5);if(error)throw new Error('Calendar jobs unavailable.');for(const j of data||[])await send('calendar-sync',{jobId:j.id},{retentionSeconds:86400});}
export async function executeCalendarJob(jobId:string){
 const deadline=Date.now()+130_000;
 const db=getSupabaseServiceRoleClient();const {data,error}=await db.rpc('claim_google_calendar_job',{p_id:jobId});if(error)throw new Error('Calendar job claim failed.');
 const job=data as {id:string;period_id:string;calendar_id:string;lease_token:string}|null;
 if(!job){const {data:existing}=await db.from('google_calendar_jobs').select('status,attempts').eq('id',jobId).maybeSingle();if(existing?.status==='syncing')throw new Error('Calendar job busy.');return;}
 const finish=async(status:string,message:string|null=null)=>{const {error}=await db.from('google_calendar_jobs').update({status,error_message:message,lease_until:null,synced_at:status==='synced'?new Date().toISOString():null}).eq('id',jobId).eq('lease_token',job.lease_token);if(error)throw new Error('Calendar job completion failed.');};
 try{
  const connection=await calendarConnection();
  const {data:period,error:periodError}=await db.from('schedule_periods').select('status').eq('id',job.period_id).single();
  if(periodError)throw new Error('Schedule unavailable.');
  if(!connection?.auto_sync || connection.calendar_id!==job.calendar_id || !['published','locked'].includes(period.status)){await finish('cancelled');return;}
  const client=await calendarClient(connection);
  const [{data:shifts,error:shiftError},{data:staff,error:staffError}]=await Promise.all([db.from('shifts').select('id,shift_date,shift_type,start_time,end_time').eq('period_id',job.period_id),db.from('staff_members').select('id,full_name')]);
  if(shiftError||staffError)throw new Error('Schedule unavailable.');
  const ids=(shifts||[]).map(s=>s.id);const {data:assignments,error:assignmentError}=ids.length?await db.from('shift_assignments').select('shift_id,staff_id').in('shift_id',ids).eq('lifecycle','published').eq('status','assigned'):{data:[],error:null};
  if(assignmentError)throw new Error('Assignments unavailable.');
  const names=new Map((staff||[]).map(s=>[s.id,s.full_name]));
  for(const shift of shifts||[]){
   if(Date.now()>deadline)throw new Error('Calendar job time budget reached.');
   const event=publishedCalendarEvent(job.period_id,shift,(assignments||[]).filter(a=>a.shift_id===shift.id).map(a=>names.get(a.staff_id)||'Staff'));
   if(!event)continue;
   const current=await calendarConnection();if(!current?.auto_sync||current.calendar_id!==job.calendar_id||current.refresh_token_ciphertext!==connection.refresh_token_ciphertext){await finish('cancelled');return;}
   const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(job.calendar_id)}/events`;
   try{await client.request({url:base,method:'POST',params:{sendUpdates:'none'},data:event,timeout:15000});}
   catch(e){if((e as {response?:{status:number}}).response?.status!==409)throw e;
    const existing=await client.request<{extendedProperties?:{private?:{wncPeriod?:string;wncShift?:string}}}>({url:`${base}/${event.id}`,timeout:15000});
    if(existing.data.extendedProperties?.private?.wncPeriod!==job.period_id||existing.data.extendedProperties.private.wncShift!==shift.id)throw new Error('Event identity mismatch.');
    await client.request({url:`${base}/${event.id}`,method:'PATCH',params:{sendUpdates:'none'},data:event,timeout:15000});}
  }
  await finish('synced');
 }catch{await finish('failed','Calendar sync could not finish. Check the Google connection and retry.');throw new Error('Calendar sync requires retry.');}
}
