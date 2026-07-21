import assert from 'node:assert/strict';
import test from 'node:test';

import { isWardenPullRequestRun, monitorWardenRun, runtimeSeconds } from '../warden-watchdog.mjs';

function wardenRun(overrides = {}) {
  return {
    id: 1,
    name: 'Warden',
    event: 'pull_request',
    status: 'in_progress',
    created_at: '2026-07-21T09:00:00Z',
    ...overrides,
  };
}

test('isWardenPullRequestRun requires the workflow name and PR event', () => {
  assert.equal(isWardenPullRequestRun(wardenRun()), true);
  assert.equal(isWardenPullRequestRun(wardenRun({ name: 'Tests' })), false);
  assert.equal(isWardenPullRequestRun(wardenRun({ event: 'push' })), false);
});

test('runtimeSeconds includes queue time and never returns a negative duration', () => {
  const run = wardenRun();

  assert.equal(runtimeSeconds(run, Date.parse('2026-07-21T09:10:00Z')), 600);
  assert.equal(runtimeSeconds(run, Date.parse('2026-07-21T08:59:00Z')), 0);
});

test('monitorWardenRun ignores non-Warden runs', async () => {
  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    getRun: async () => wardenRun({ name: 'Tests' }),
    cancelRun: async () => assert.fail('non-Warden run must not be cancelled'),
  });

  assert.deepEqual(result, { cancelled: false, ignored: true });
});

test('monitorWardenRun returns when the Warden run completes', async () => {
  const runs = [wardenRun(), wardenRun({ status: 'completed' })];
  let nowMs = Date.parse('2026-07-21T09:00:00Z');

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => nowMs,
    sleep: async (milliseconds) => {
      nowMs += milliseconds;
    },
    getRun: async () => runs.shift(),
    cancelRun: async () => assert.fail('completed run must not be cancelled'),
  });

  assert.deepEqual(result, { cancelled: false, ignored: false });
});

test('monitorWardenRun cancels a queued Warden run at the runtime limit', async () => {
  let cancelled = false;

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => Date.parse('2026-07-21T09:10:00Z'),
    sleep: async () => assert.fail('stale run must be cancelled immediately'),
    getRun: async () => wardenRun({ status: 'queued' }),
    cancelRun: async () => {
      cancelled = true;
      return true;
    },
  });

  assert.equal(cancelled, true);
  assert.deepEqual(result, { cancelled: true, ignored: false });
});

test('monitorWardenRun calculates each delay from one clock reading', async () => {
  const runs = [wardenRun(), wardenRun({ status: 'completed' })];
  const times = [Date.parse('2026-07-21T09:09:59.999Z'), Date.parse('2026-07-21T09:10:00.001Z')];
  let sleptMilliseconds = 0;

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => times.shift(),
    sleep: async (milliseconds) => {
      sleptMilliseconds = milliseconds;
    },
    getRun: async () => runs.shift(),
    cancelRun: async () => assert.fail('completed run must not be cancelled'),
  });

  assert.equal(sleptMilliseconds, 1);
  assert.deepEqual(result, { cancelled: false, ignored: false });
});

test('monitorWardenRun never sleeps past the runtime limit', async () => {
  let nowMs = Date.parse('2026-07-21T09:09:58Z');
  let sleptMilliseconds = 0;

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => nowMs,
    sleep: async (milliseconds) => {
      sleptMilliseconds += milliseconds;
      nowMs += milliseconds;
    },
    getRun: async () => wardenRun(),
    cancelRun: async () => true,
  });

  assert.equal(sleptMilliseconds, 2_000);
  assert.deepEqual(result, { cancelled: true, ignored: false });
});

test('monitorWardenRun handles a run completing during cancellation', async () => {
  const runs = [wardenRun(), wardenRun({ status: 'completed' })];

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => Date.parse('2026-07-21T09:10:00Z'),
    sleep: async () => assert.fail('stale run must attempt cancellation immediately'),
    getRun: async () => runs.shift(),
    cancelRun: async () => false,
  });

  assert.deepEqual(result, { cancelled: false, ignored: false });
});

test('monitorWardenRun fails if a rejected cancellation leaves the run active', async () => {
  await assert.rejects(
    monitorWardenRun({
      maxRuntimeSeconds: 600,
      pollSeconds: 15,
      now: () => Date.parse('2026-07-21T09:10:00Z'),
      sleep: async () => assert.fail('stale run must attempt cancellation immediately'),
      getRun: async () => wardenRun(),
      cancelRun: async () => false,
    }),
    /remained active/,
  );
});
