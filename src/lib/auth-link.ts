export function readAuthLink(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const type = fragment.get("type");
  return {
    code: query.get("code"),
    flowId: query.get("sb_flow_id") ?? undefined,
    recovery: type === "recovery" || query.get("mode") === "recovery",
    sessionRecovery: query.get("mode") === "recovery",
    accessToken: type === "invite" || type === "recovery" ? fragment.get("access_token") : null,
    refreshToken: type === "invite" || type === "recovery" ? fragment.get("refresh_token") : null,
    errorCode: query.get("error_code") ?? fragment.get("error_code"),
  };
}

export function authLinkErrorMessage(code?: string | null) {
  if (code === "pkce_code_verifier_not_found" || code === "bad_code_verifier") {
    return "Open this link in the same browser where you requested it. If that browser is no longer available, request a new reset link from this browser.";
  }
  if (code === "otp_expired" || code === "flow_state_expired" || code === "flow_state_not_found") {
    return "This link has expired or has already been used. Request a new password reset link, or ask your manager for a new invitation.";
  }
  return "This link could not be verified. Request a new password reset link, or ask your manager for a new invitation.";
}
