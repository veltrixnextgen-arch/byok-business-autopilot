import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveScheduleMetadata } from "./scheduleMetadata.js";

test("triage/escalation agent types are always event-driven, regardless of frequency", () => {
  assert.deepEqual(deriveScheduleMetadata("daily", "customer-triage"), {
    cadence: null,
    batchable: false,
    triggerType: "event",
  });
  assert.deepEqual(deriveScheduleMetadata("weekly", "vendor-escalation"), {
    cadence: null,
    batchable: false,
    triggerType: "event",
  });
});

test("expense-categorization-shaped agent types are nightly-batched", () => {
  assert.deepEqual(deriveScheduleMetadata("weekly", "expense-tracker"), {
    cadence: "nightly",
    batchable: true,
    triggerType: "cadence",
  });
});

test("cashflow/forecast-shaped agent types are weekly, not their stated frequency", () => {
  assert.deepEqual(deriveScheduleMetadata("monthly", "cashflow-projection"), {
    cadence: "weekly",
    batchable: false,
    triggerType: "cadence",
  });
});

test("tax-shaped agent types are monthly", () => {
  assert.deepEqual(deriveScheduleMetadata("weekly", "tax-filing-tracker"), {
    cadence: "monthly",
    batchable: false,
    triggerType: "cadence",
  });
});

test("inventory/reorder-shaped agent types are threshold checks", () => {
  assert.deepEqual(deriveScheduleMetadata("daily", "stock-inventory"), {
    cadence: "daily",
    batchable: true,
    triggerType: "threshold",
  });
});

test("adhoc frequency with no keyword match has no standing schedule", () => {
  assert.deepEqual(deriveScheduleMetadata("adhoc", "seasonal-menu-planner"), {
    cadence: null,
    batchable: false,
    triggerType: "event",
  });
});

test("a fixed-frequency task with no keyword match maps cadence 1:1 to frequency", () => {
  assert.deepEqual(deriveScheduleMetadata("daily", "social-post-drafter"), {
    cadence: "daily",
    batchable: false,
    triggerType: "cadence",
  });
  assert.deepEqual(deriveScheduleMetadata("weekly", "newsletter-writer"), {
    cadence: "weekly",
    batchable: false,
    triggerType: "cadence",
  });
  assert.deepEqual(deriveScheduleMetadata("monthly", "brand-review"), {
    cadence: "monthly",
    batchable: false,
    triggerType: "cadence",
  });
});
