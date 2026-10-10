export async function reviewScheduleOnWebsite({ origin, accessToken, periodId, publish = false, fetchImpl = fetch }: {
  origin: string; accessToken: string; periodId: string; publish?: boolean; fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchImpl(new URL("/api/scheduling_engine", origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: publish ? "publish" : "validate", period_id: periodId }),
      signal: AbortSignal.timeout(55_000), cache: "no-store",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || result?.ready !== true) return {
      ok: false, message: result?.message ?? "The schedule could not be checked. Refresh and try again.",
    };
    return { ok: true, message: result.message };
  } catch {
    return { ok: false, message: "The schedule check was interrupted. Refresh before trying again." };
  }
}
