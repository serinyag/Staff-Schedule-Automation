import test from "node:test";
import assert from "node:assert/strict";
import { formatSubmittedAt } from "./availability";

test("timestamps render identically on the server and in other browser time zones", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const server = formatSubmittedAt("2026-07-22T08:21:00Z");
    process.env.TZ = "Europe/Amsterdam";
    assert.equal(formatSubmittedAt("2026-07-22T08:21:00Z"), server);
    process.env.TZ = "America/Los_Angeles";
    assert.equal(formatSubmittedAt("2026-07-22T08:21:00Z"), server);
    assert.equal(server, "Jul 22, 10:21 AM");
    assert.equal(formatSubmittedAt("2026-01-22T08:21:00Z"), "Jan 22, 9:21 AM");
    assert.equal(formatSubmittedAt(null), null);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
