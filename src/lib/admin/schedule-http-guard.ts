export async function readScheduleCommand(request: Request): Promise<unknown> {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("origin");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("content-type");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); throw new Error("size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
