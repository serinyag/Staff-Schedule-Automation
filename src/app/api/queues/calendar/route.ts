import {handleCallback} from '@vercel/queue';
import {executeCalendarJob} from '@/lib/server/google-calendar';
import {isUuid} from '@/lib/admin/schedule-commands';
export const maxDuration=180;
export const POST=handleCallback<{jobId:string}>(async({jobId})=>{if(!isUuid(jobId))throw new Error('Invalid calendar job');await executeCalendarJob(jobId);},{visibilityTimeoutSeconds:300,retry:()=>({afterSeconds:60})});
