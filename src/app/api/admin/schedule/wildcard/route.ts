import {NextResponse} from 'next/server';
import {revalidatePath} from 'next/cache';
import {authorizedScheduleManager,readScheduleCommand,scheduleError} from '@/lib/server/schedule-http';
import {isUuid} from '@/lib/admin/schedule-commands';
export async function POST(request:Request){const auth=await authorizedScheduleManager();if(auth.status!==200)return NextResponse.json({message:auth.message},{status:auth.status});
 let b:{periodId?:string;shiftId?:string;hourlyRate?:number;independent?:boolean};try{b=await readScheduleCommand(request) as typeof b;}catch{return NextResponse.json({message:'Invalid wildcard request.'},{status:400});}
 if(!b||!b.periodId||!isUuid(b.periodId)||!b.shiftId||!isUuid(b.shiftId)||typeof b.hourlyRate!=='number'||!Number.isFinite(b.hourlyRate)||b.hourlyRate<0||b.hourlyRate>1000||b.independent!==true)return NextResponse.json({message:'Confirm independent coverage and enter Patrick’s hourly rate.'},{status:400});
 const {error}=await auth.supabase.rpc('assign_wildcard_cover',{p_period_id:b.periodId,p_shift_id:b.shiftId,p_hourly_rate:b.hourlyRate,p_independent:true});if(error){const result=scheduleError(error);return NextResponse.json({message:result.message},{status:result.status});}
 revalidatePath('/admin/schedule');return NextResponse.json({message:'Patrick added as wildcard cover.'});}
