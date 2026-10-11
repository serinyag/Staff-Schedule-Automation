import {CodeChallengeMethod} from 'google-auth-library';
import {scheduleAppOrigin} from '@/lib/server/schedule-worker';
import {randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {authorizedScheduleManager} from '@/lib/server/schedule-http';
import {googleOAuth,calendarReady} from '@/lib/server/google-calendar';
export async function GET(){
 const auth=await authorizedScheduleManager();if(auth.status!==200)return NextResponse.json({message:auth.message},{status:auth.status});
 if(!calendarReady())return NextResponse.redirect(new URL('/admin/schedule?calendar=setup-needed',scheduleAppOrigin()));
 const state=randomBytes(32).toString('hex');const verifier=randomBytes(48).toString('base64url');
 const {createHash}=await import('node:crypto');
 (await cookies()).set('wnc-calendar-oauth',JSON.stringify({state,verifier}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:600,path:'/api/admin/calendar'});
 return NextResponse.redirect(googleOAuth().generateAuthUrl({state,access_type:'offline',prompt:'consent',scope:['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:CodeChallengeMethod.S256}));
}
