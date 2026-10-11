import assert from "node:assert/strict";
import test from "node:test";
import { sendPasswordReset } from "../supabase/recovery";

test("reset emails use browser-independent verification without a PKCE challenge or app session", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://recovery-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-key";
  const requests: { url: string; body: Record<string, unknown>; authorization: string | null }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await sendPasswordReset("staff@example.com", "https://staff.example/auth/callback?next=%2Fauth%2Fcomplete%3Fmode%3Drecovery");
    assert.equal(result.error, null);
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).pathname, "/auth/v1/recover");
    assert.equal(new URL(requests[0].url).searchParams.get("redirect_to"), "https://staff.example/auth/callback?next=%2Fauth%2Fcomplete%3Fmode%3Drecovery");
    assert.equal(requests[0].body.email, "staff@example.com");
    assert.equal(requests[0].body.code_challenge, null);
    assert.equal(requests[0].body.code_challenge_method, null);
    assert.equal(requests[0].authorization, "Bearer public-test-key");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
