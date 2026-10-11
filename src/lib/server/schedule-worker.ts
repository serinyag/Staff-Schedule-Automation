import "server-only";
import { createHmac } from "node:crypto";
import { send } from "@vercel/queue";
import { getSupabaseServiceRoleKey } from "@/lib/supabase/service";

export function scheduleAppOrigin() {
  const configured = process.env.SCHEDULE_APP_ORIGIN;
  // Production alias avoids Deployment Protection on per-deployment URLs.
  // A staged deployment is promoted only after its database migration passes.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return configured || (host ? `https://${host}` : "http://localhost:3000");
}

export async function dispatchScheduleRun(runId: string) {
  await send("schedule-generation", { runId }, { idempotencyKey: runId, retentionSeconds: 3600 });
}

export async function executeScheduleRun(runId: string) {
  const body = JSON.stringify({ run_id: runId });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", getSupabaseServiceRoleKey())
    .update(`schedule-worker-v1\n${timestamp}\n${body}`).digest("hex");
  const response = await fetch(new URL("/api/scheduling_engine", scheduleAppOrigin()), {
    method: "POST", body,
    headers: { "Content-Type": "application/json", "X-Schedule-Signature": signature, "X-Schedule-Timestamp": timestamp },
    signal: AbortSignal.timeout(150_000), cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error("Schedule worker needs redelivery");
}
