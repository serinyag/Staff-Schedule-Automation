import assert from "node:assert/strict";
import test from "node:test";
import { authLinkErrorMessage, readAuthLink } from "../auth-link";

test("a PKCE code landing directly on the site URL is accepted with its flow ID", () => {
  const link = readAuthLink("?code=test-code&sb_flow_id=test-flow&mode=recovery", "");
  assert.equal(link.code, "test-code");
  assert.equal(link.flowId, "test-flow");
  assert.equal(link.recovery, true);
});

test("legacy invitation and recovery fragments remain supported", () => {
  for (const type of ["invite", "recovery"]) {
    const link = readAuthLink("", `#type=${type}&access_token=test-access&refresh_token=test-refresh`);
    assert.equal(link.accessToken, "test-access");
    assert.equal(link.refreshToken, "test-refresh");
    assert.equal(link.recovery, type === "recovery");
  }
  assert.equal(readAuthLink("", "#type=unrecognized&access_token=test").accessToken, null);
});

test("missing browser verification is distinguished from an expired or used link", () => {
  assert.match(authLinkErrorMessage("pkce_code_verifier_not_found"), /same browser/);
  assert.match(authLinkErrorMessage("otp_expired"), /expired or has already been used/);
  assert.doesNotMatch(authLinkErrorMessage("unknown"), /has expired/);
});

test("provider errors in either query or fragment are retained without reflecting their description", () => {
  assert.equal(readAuthLink("?error_code=otp_expired", "").errorCode, "otp_expired");
  assert.equal(readAuthLink("", "#error_code=otp_expired&error_description=private").errorCode, "otp_expired");
  assert.doesNotMatch(authLinkErrorMessage("private"), /private/);
});
