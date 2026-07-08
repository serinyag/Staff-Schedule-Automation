export const SCHEDULE_ORCHESTRATION_TIMEOUT_MS = 10_000;

export type ScheduleGenerationWebhookPayload = {
  generation_run_id: string;
  period_id: string;
};

export type ScheduleOrchestrationSuccess = {
  ok: true;
};

export type ScheduleOrchestrationFailureCode =
  | "missing_webhook_url"
  | "timeout"
  | "non_2xx_response"
  | "network_error";

export type ScheduleOrchestrationFailure = {
  ok: false;
  code: ScheduleOrchestrationFailureCode;
  managerMessage: string;
  runFailureMessage: string;
};

export type ScheduleOrchestrationResult =
  | ScheduleOrchestrationSuccess
  | ScheduleOrchestrationFailure;

export async function triggerScheduleGenerationWebhook({
  webhookUrl,
  payload,
  fetchImpl = fetch,
  timeoutMs = SCHEDULE_ORCHESTRATION_TIMEOUT_MS,
}: {
  webhookUrl: string | undefined;
  payload: ScheduleGenerationWebhookPayload;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ScheduleOrchestrationResult> {
  if (!webhookUrl) {
    return {
      ok: false,
      code: "missing_webhook_url",
      managerMessage:
        "Schedule generation is not configured yet. The run was marked failed.",
      runFailureMessage: "Orchestration webhook is not configured.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        code: "non_2xx_response",
        managerMessage:
          "Schedule generation could not be started. The run was marked failed.",
        runFailureMessage: "Orchestration webhook returned an error response.",
      };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        code: "timeout",
        managerMessage:
          "Schedule generation timed out while contacting orchestration. The run was marked failed.",
        runFailureMessage: "Orchestration startup timed out.",
      };
    }

    return {
      ok: false,
      code: "network_error",
      managerMessage:
        "Schedule generation could not reach orchestration. The run was marked failed.",
      runFailureMessage: "Orchestration could not be reached.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function startScheduleGenerationOrchestration({
  webhookUrl,
  payload,
  markRunFailed,
  fetchImpl = fetch,
  timeoutMs = SCHEDULE_ORCHESTRATION_TIMEOUT_MS,
}: {
  webhookUrl: string | undefined;
  payload: ScheduleGenerationWebhookPayload;
  markRunFailed: (failureMessage: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ScheduleOrchestrationResult> {
  const result = await triggerScheduleGenerationWebhook({
    webhookUrl,
    payload,
    fetchImpl,
    timeoutMs,
  });

  if (!result.ok) {
    await markRunFailed(result.runFailureMessage);
  }

  return result;
}
