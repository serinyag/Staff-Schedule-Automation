import { handleCallback } from "@vercel/queue";
import { executeScheduleRun } from "@/lib/server/schedule-worker";
export const maxDuration = 180;
export const POST = handleCallback<{ runId: string }>(async ({ runId }) => {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Invalid schedule job");
  await executeScheduleRun(runId);
}, { visibilityTimeoutSeconds: 300, retry: () => ({ afterSeconds: 60 }) });
