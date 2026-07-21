import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SCHEDULE_ORCHESTRATION_TIMEOUT_MS,
  startScheduleGenerationOrchestration,
  triggerScheduleGenerationWebhook,
} from "./schedule-orchestration";

const payload = {
  generation_run_id: "run-123",
  period_id: "period-456",
};

test("acknowledged webhook succeeds and sends only run and period ids", async () => {
  let capturedRequestInit: RequestInit | undefined;

  const result = await triggerScheduleGenerationWebhook({
    webhookUrl: "https://example.com/private-webhook",
    payload,
    fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequestInit = init;
      return new Response(null, { status: 202 });
    },
  });

  assert.equal(result.ok, true);
  assert.ok(capturedRequestInit);
  assert.equal(capturedRequestInit?.method, "POST");
  assert.equal(capturedRequestInit?.headers && (capturedRequestInit.headers as Record<string, string>)["Content-Type"], "application/json");

  const parsedBody = JSON.parse(String(capturedRequestInit?.body));
  assert.deepEqual(parsedBody, payload);
  assert.deepEqual(Object.keys(parsedBody).sort(), ["generation_run_id", "period_id"]);
});

test("missing webhook url fails with configuration error", async () => {
  const result = await triggerScheduleGenerationWebhook({
    webhookUrl: undefined,
    payload,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "missing_webhook_url",
    managerMessage: "Schedule generation is not configured yet. The run was marked failed.",
    runFailureMessage: "Orchestration webhook is not configured.",
  });
});

test("non-2xx webhook response fails cleanly", async () => {
  const result = await triggerScheduleGenerationWebhook({
    webhookUrl: "https://example.com/private-webhook",
    payload,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });

  assert.deepEqual(result, {
    ok: false,
    code: "non_2xx_response",
    managerMessage: "Schedule generation could not be started. The run was marked failed.",
    runFailureMessage: "Orchestration webhook returned an error response.",
  });
});

test("network failure is surfaced without leaking internals", async () => {
  const result = await triggerScheduleGenerationWebhook({
    webhookUrl: "https://example.com/private-webhook",
    payload,
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    code: "network_error",
    managerMessage: "Schedule generation could not reach orchestration. The run was marked failed.",
    runFailureMessage: "Orchestration could not be reached.",
  });
});

test("timeout is bounded and returns a timeout failure", async () => {
  const result = await triggerScheduleGenerationWebhook({
    webhookUrl: "https://example.com/private-webhook",
    payload,
    timeoutMs: 5,
    fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Timed out", "AbortError"));
        });
      }),
  });

  assert.deepEqual(result, {
    ok: false,
    code: "timeout",
    managerMessage:
      "Schedule generation timed out while contacting orchestration. The run was marked failed.",
    runFailureMessage: "Orchestration startup timed out.",
  });
});

test("default timeout remains bounded", () => {
  assert.equal(SCHEDULE_ORCHESTRATION_TIMEOUT_MS, 10_000);
});

test("failed orchestration startup marks the run failed", async () => {
  const failureMessages: string[] = [];

  const result = await startScheduleGenerationOrchestration({
    webhookUrl: undefined,
    payload,
    markRunFailed: async (failureMessage: string) => {
      failureMessages.push(failureMessage);
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(failureMessages, ["Orchestration webhook is not configured."]);
});

test("duplicate active run protection remains enforced in the queue RPC migration", async () => {
  const migration = await readFile(
    new URL("../../../supabase/migrations/013_schedule_generation_runs.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /schedule_generation_runs_active_period_idx/);
  assert.match(migration, /raise exception 'A schedule generation run is already active for this period\.'/);
  assert.match(migration, /using errcode = '23505'/);
});
