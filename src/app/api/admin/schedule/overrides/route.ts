import {NextResponse} from 'next/server';
import {revalidatePath} from 'next/cache';
import {authorizedScheduleManager,readScheduleCommand} from '@/lib/server/schedule-http';
import {reviewScheduleOnWebsite} from '@/lib/admin/schedule-orchestration';
import {scheduleAppOrigin} from '@/lib/server/schedule-worker';
import {isUuid} from '@/lib/admin/schedule-commands';
export async function POST(request:Request){
 const auth=await authorizedScheduleManager();if(auth.status!==200)return NextResponse.json({message:auth.message},{status:auth.status});
 let body:{action?:string;periodId?:string;hashes?:string[];reason?:string};try{body=await readScheduleCommand(request) as typeof body;}catch{return NextResponse.json({message:'Invalid override request.'},{status:400});}
 if(!body||!body.periodId||!isUuid(body.periodId))return NextResponse.json({message:'Choose a schedule period.'},{status:400});
 if(body.action==='approve'){
  if(!Array.isArray(body.hashes)||!body.hashes.length||body.hashes.length>50||body.hashes.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))||typeof body.reason!=='string'||body.reason.trim().length<10||body.reason.length>1000)return NextResponse.json({message:'Select restrictions and add a reason of 10 to 1000 characters.'},{status:400});
  const {error}=await auth.supabase.rpc('approve_schedule_rule_overrides',{p_period_id:body.periodId,p_issue_hashes:body.hashes,p_reason:body.reason.trim()});
  if(error)return NextResponse.json({message:error.code==='P0001'?error.message:'Overrides could not be saved.'},{status:409});
 }else if(body.action!=='review')return NextResponse.json({message:'Invalid override action.'},{status:400});
 const {data:session}=await auth.supabase.auth.getSession();
 const checked=await reviewScheduleOnWebsite({origin:scheduleAppOrigin(),accessToken:session.session?.access_token||'',periodId:body.periodId});
 const {data,error}=await auth.supabase.rpc('schedule_override_review',{p_period_id:body.periodId});
 const {data:staff}=await auth.supabase.from('staff_members').select('id,full_name');
 revalidatePath('/admin/schedule');
 if(error||!data)return NextResponse.json({message:'The current draft could not be checked. Try again.'},{status:503});
 return NextResponse.json({review:data,staff:staff||[],message:body.action==='approve'?'Overrides recorded. Recheck any remaining issues before publishing.':checked.message});
}
