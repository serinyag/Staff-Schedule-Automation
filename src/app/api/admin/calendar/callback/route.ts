import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {authorizedScheduleManager} from '@/lib/server/schedule-http';
import {googleOAuth,encryptCalendarToken} from '@/lib/server/google-calendar';
import {getSupabaseServiceRoleClient} from '@/lib/supabase/service';
import {scheduleAppOrigin} from '@/lib/server/schedule-worker';
export async function GET(request:Request){
 const auth=await authorizedScheduleManager();if(auth.status!==200)return NextResponse.json({message:auth.message},{status:auth.status});
 const jar=await cookies();const saved=jar.get('wnc-calendar-oauth')?.value;jar.delete({name:'wnc-calendar-oauth',path:'/api/admin/calendar'});
 const q=new URL(request.url).searchParams;
 const redirect=(result:string)=>NextResponse.redirect(new URL(`/admin/schedule?calendar=${result}`,scheduleAppOrigin()));
 try{const flow=JSON.parse(saved||'null');if(!flow?.state||flow.state!==q.get('state')||!q.get('code')||q.get('error'))return redirect('connection-failed');
  const {tokens}=await googleOAuth().getToken({code:q.get('code')!,codeVerifier:flow.verifier});
  const scopes=(tokens.scope||'').split(' ');if(!tokens.refresh_token||!scopes.includes('https://www.googleapis.com/auth/calendar.events')||!scopes.includes('https://www.googleapis.com/auth/calendar.calendarlist.readonly'))return redirect('connection-failed');
  const {error}=await getSupabaseServiceRoleClient().from('google_calendar_connection').upsert({singleton:true,refresh_token_ciphertext:encryptCalendarToken(tokens.refresh_token),calendar_id:null,calendar_name:null,auto_sync:false,updated_at:new Date().toISOString()});
  if(error)throw new Error('Store failed');return redirect('connected');
 }catch{return redirect('connection-failed');}
}
