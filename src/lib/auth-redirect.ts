export function normalizeNextPath(path: string | undefined) {
  const fallback = "/auth/redirect";
  if (!path?.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) return fallback;
  try {
    const destination = new URL(path, "https://internal.invalid");
    return destination.origin === "https://internal.invalid" ? destination.pathname + destination.search + destination.hash : fallback;
  } catch { return fallback; }
}
