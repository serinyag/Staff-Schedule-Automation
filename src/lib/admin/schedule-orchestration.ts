export const SCHEDULE_ORCHESTRATION_TIMEOUT_MS = 110_000;

export async function generateScheduleOnWebsite({ origin, accessToken, runId, periodId, fetchImpl = fetch, timeoutMs = SCHEDULE_ORCHESTRATION_TIMEOUT_MS }: {
  origin: string; accessToken: string; runId: string; periodId: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchImpl(new URL("/api/scheduling_engine", origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ generation_run_id: runId, period_id: periodId }),
      signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) return { ok: false, message: result?.message ?? "Schedule generation could not complete. Please try again." };
    return { ok: true, message: result.message ?? "Draft created. Review before publishing." };
  } catch {
    return { ok: false, message: "Schedule generation was interrupted. Refresh the schedule before trying again." };
  }
}
