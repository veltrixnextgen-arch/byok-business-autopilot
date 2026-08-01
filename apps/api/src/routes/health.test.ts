import assert from "node:assert/strict";
import { test } from "node:test";
import { healthRoute } from "./health.js";

test("health returns ok", async () => {
  const res = await healthRoute.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});
