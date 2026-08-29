import assert from "node:assert/strict";
import { test } from "node:test";
import { templateLearningPatternsRoute, type TemplateLearningPatternsDeps } from "./templateLearningPatterns.js";

function fakeDeps(overrides: Partial<TemplateLearningPatternsDeps> = {}): TemplateLearningPatternsDeps {
  return {
    deltaStore: {
      async aggregatedPatterns(minDistinctUsers: number) {
        return {
          removed: [{ templateId: "service", taskId: "vendor-management", userCount: minDistinctUsers }],
          frequencyChanged: [],
          added: [],
        };
      },
    },
    token: "correct-token",
    ...overrides,
  };
}

test("401s with no token, no pattern data leaked", async () => {
  const app = templateLearningPatternsRoute(fakeDeps());
  const res = await app.request("/");
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Unauthorized" });
});

test("401s with the wrong token", async () => {
  const app = templateLearningPatternsRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "wrong" } });
  assert.equal(res.status, 401);
});

test("defaults to a threshold of 5 distinct users when ?minUsers isn't given", async () => {
  const app = templateLearningPatternsRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { minDistinctUsers: number };
  assert.equal(body.minDistinctUsers, 5);
});

test("?minUsers overrides the default threshold, floored to an integer", async () => {
  const app = templateLearningPatternsRoute(fakeDeps());
  const res = await app.request("/?minUsers=8.9", { headers: { "x-internal-metrics-token": "correct-token" } });
  const body = (await res.json()) as { minDistinctUsers: number };
  assert.equal(body.minDistinctUsers, 8);
});

test("?minUsers below 2 is ignored — a single business's own edit can never surface as a pattern", async () => {
  const app = templateLearningPatternsRoute(fakeDeps());
  const res = await app.request("/?minUsers=1", { headers: { "x-internal-metrics-token": "correct-token" } });
  const body = (await res.json()) as { minDistinctUsers: number };
  assert.equal(body.minDistinctUsers, 5, "an invalid override falls back to the safe default, not the requested unsafe value");
});

test("a non-numeric ?minUsers is ignored, same as omitting it", async () => {
  const app = templateLearningPatternsRoute(fakeDeps());
  const res = await app.request("/?minUsers=not-a-number", { headers: { "x-internal-metrics-token": "correct-token" } });
  const body = (await res.json()) as { minDistinctUsers: number };
  assert.equal(body.minDistinctUsers, 5);
});
