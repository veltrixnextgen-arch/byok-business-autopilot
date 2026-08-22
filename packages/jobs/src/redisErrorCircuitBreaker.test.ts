import assert from "node:assert/strict";
import { test } from "node:test";
import { attachRedisErrorCircuitBreaker } from "./redisErrorCircuitBreaker.js";

/** A fake worker plus a fake clock/timer so tests never wait on real time
 *  and can deterministically simulate "the cooldown elapsed" or "a long
 *  healthy stretch passed" without a real setTimeout in the mix. */
function fakeHarness() {
  let clock = 0;
  const listeners: ((err: Error) => void)[] = [];
  const pauseCalls: boolean[] = [];
  let resumeCalls = 0;
  const scheduled: { fn: () => void; ms: number; firesAt: number }[] = [];

  const worker = {
    async pause(doNotWaitActive?: boolean) {
      pauseCalls.push(doNotWaitActive ?? false);
    },
    resume() {
      resumeCalls++;
    },
    on(_event: "error", listener: (err: Error) => void) {
      listeners.push(listener);
    },
  };

  function emitError(message = "ERR max requests limit exceeded") {
    for (const l of listeners) l(new Error(message));
  }

  /** Advances the fake clock and fires any scheduled timeouts whose delay has elapsed. */
  function advance(ms: number) {
    clock += ms;
    for (const s of [...scheduled]) {
      if (clock >= s.firesAt) {
        scheduled.splice(scheduled.indexOf(s), 1);
        s.fn();
      }
    }
  }

  return {
    worker,
    emitError,
    advance,
    pauseCalls,
    get resumeCalls() {
      return resumeCalls;
    },
    now: () => clock,
    setTimeoutFn: (fn: () => void, ms: number) => {
      scheduled.push({ fn, ms, firesAt: clock + ms });
      return {};
    },
  };
}

test("does not trip below the error threshold", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, { errorThreshold: 10, windowMs: 5000, now: h.now, setTimeoutFn: h.setTimeoutFn });
  for (let i = 0; i < 9; i++) h.emitError();
  assert.equal(h.pauseCalls.length, 0);
});

test("trips (pauses with doNotWaitActive=true) once the threshold is reached within the window", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, { errorThreshold: 10, windowMs: 5000, now: h.now, setTimeoutFn: h.setTimeoutFn });
  for (let i = 0; i < 10; i++) h.emitError();
  assert.deepEqual(h.pauseCalls, [true]);
});

test("errors outside the sliding window don't count toward the threshold", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, { errorThreshold: 10, windowMs: 5000, now: h.now, setTimeoutFn: h.setTimeoutFn });
  for (let i = 0; i < 5; i++) h.emitError();
  h.advance(6000); // past the 5000ms window — those 5 should age out
  for (let i = 0; i < 5; i++) h.emitError();
  assert.equal(h.pauseCalls.length, 0, "only 5 errors are within the current window, below the threshold of 10");
});

test("ignores further errors while already tripped, instead of pausing repeatedly", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, { errorThreshold: 10, windowMs: 5000, now: h.now, setTimeoutFn: h.setTimeoutFn });
  for (let i = 0; i < 30; i++) h.emitError();
  assert.equal(h.pauseCalls.length, 1);
});

test("resumes automatically after the cooldown elapses", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, {
    errorThreshold: 10,
    windowMs: 5000,
    initialCooldownMs: 30_000,
    now: h.now,
    setTimeoutFn: h.setTimeoutFn,
  });
  for (let i = 0; i < 10; i++) h.emitError();
  assert.equal(h.resumeCalls, 0);
  h.advance(30_000);
  assert.equal(h.resumeCalls, 1);
});

test("escalates the cooldown (doubles) if it trips again shortly after resuming", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, {
    errorThreshold: 5,
    windowMs: 1000,
    initialCooldownMs: 1000,
    maxCooldownMs: 60_000,
    now: h.now,
    setTimeoutFn: h.setTimeoutFn,
  });

  for (let i = 0; i < 5; i++) h.emitError(); // trip #1, cooldown 1000ms
  h.advance(1000); // resumes
  assert.equal(h.resumeCalls, 1);

  for (let i = 0; i < 5; i++) h.emitError(); // trips again immediately — still unhealthy
  assert.deepEqual(h.pauseCalls, [true, true]);

  h.advance(2000); // escalated cooldown should now be 2000ms, not 1000ms
  assert.equal(h.resumeCalls, 2);
});

test("resets the cooldown back to the initial value after a genuinely healthy stretch", () => {
  const h = fakeHarness();
  attachRedisErrorCircuitBreaker(h.worker, {
    errorThreshold: 5,
    windowMs: 1000,
    initialCooldownMs: 1000,
    maxCooldownMs: 60_000,
    now: h.now,
    setTimeoutFn: h.setTimeoutFn,
  });

  for (let i = 0; i < 5; i++) h.emitError(); // trip #1, cooldown 1000ms
  h.advance(1000); // resumes at t=1000
  assert.equal(h.resumeCalls, 1);

  h.advance(10_000); // a long healthy stretch — well past 2x the 1000ms cooldown

  for (let i = 0; i < 5; i++) h.emitError(); // a fresh incident, not a continuation
  h.advance(1000); // should resume after the RESET (initial) 1000ms cooldown, not an escalated one
  assert.equal(h.resumeCalls, 2);
});

test("a failing pause() is caught, not thrown from the error listener", () => {
  const h = fakeHarness();
  const worker = {
    ...h.worker,
    pause: async () => {
      throw new Error("pause failed");
    },
  };
  attachRedisErrorCircuitBreaker(worker, { errorThreshold: 3, windowMs: 5000, now: h.now, setTimeoutFn: h.setTimeoutFn });
  assert.doesNotThrow(() => {
    for (let i = 0; i < 3; i++) h.emitError();
  });
});
