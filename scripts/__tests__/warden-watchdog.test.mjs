import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  githubRequest,
  isPullRequestRun,
  monitorWardenRun,
  runStartTimeMs,
  runtimeSeconds,
} from '../warden-watchdog.mjs';

function wardenRun(overrides = {}) {
  return {
    id: 1,
    name: 'Warden',
    event: 'pull_request',
    status: 'in_progress',
    run_attempt: 1,
    created_at: '2026-07-21T09:00:00Z',
    run_started_at: '2026-07-21T09:01:00Z',
    ...overrides,
  };
}

test('githubRequest scopes conflict handling to callers that allow it', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({ ok: false, status: 409 });

  await assert.rejects(githubRequest('/run'), /GitHub API GET \/run failed: 409/);
  assert.equal(await githubRequest('/cancel', { method: 'POST', allowConflict: true }), null);
});

test('workflow starts the watchdog for initial runs and reruns', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/warden-watchdog.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /types: \[requested, in_progress\]/);
  assert.match(workflow, /github\.event\.action == 'requested'/);
  assert.match(workflow, /github\.event\.workflow_run\.run_attempt > 1/);
  assert.match(
    workflow,
    / {4}concurrency:\n {6}group: warden-watchdog-\$\{\{ github\.event\.workflow_run\.id \}\}\n {6}cancel-in-progress: true/,
  );
  assert.match(
    workflow,
    /TARGET_RUN_ATTEMPT: \$\{\{ github\.event\.workflow_run\.run_attempt \}\}/,
  );
});

test('isPullRequestRun classifies runs using only the event', () => {
  assert.equal(isPullRequestRun(wardenRun()), true);
  assert.equal(isPullRequestRun(wardenRun({ name: '' })), true);
  assert.equal(isPullRequestRun(wardenRun({ event: 'push' })), false);
});

test('runtimeSeconds includes queue time and never returns a negative duration', () => {
  const run = wardenRun();

  assert.equal(runtimeSeconds(run, Date.parse('2026-07-21T09:10:00Z')), 600);
  assert.equal(runtimeSeconds(run, Date.parse('2026-07-21T08:59:00Z')), 0);
});

test('runStartTimeMs includes queue time from attempt-scoped rerun metadata', () => {
  const rerun = wardenRun({
    run_attempt: 3,
    created_at: '2026-07-21T09:30:00Z',
    run_started_at: '2026-07-21T09:36:28Z',
  });

  assert.equal(runStartTimeMs(rerun), Date.parse('2026-07-21T09:30:00Z'));
  assert.equal(runtimeSeconds(rerun, Date.parse('2026-07-21T09:40:00Z')), 600);
});

test('runStartTimeMs rejects a rerun without a valid attempt timestamp', () => {
  assert.throws(
    () => runStartTimeMs(wardenRun({ run_attempt: 2, created_at: null })),
    /invalid start timestamp/,
  );
});

test('monitorWardenRun ignores non-PR runs', async () => {
  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    getRun: async () => wardenRun({ event: 'push' }),
    cancelRun: async () => assert.fail('non-PR run must not be cancelled'),
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

test('monitorWardenRun does not cancel a newer run attempt', async () => {
  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    expectedRunAttempt: 1,
    now: () => Date.parse('2026-07-21T09:10:00Z'),
    sleep: async () => assert.fail('stale run must check the current attempt immediately'),
    getRun: async () => wardenRun({ run_attempt: 1 }),
    getCurrentRun: async () => wardenRun({ run_attempt: 2 }),
    cancelRun: async () => assert.fail('a superseded attempt must not cancel the current run'),
  });

  assert.deepEqual(result, { cancelled: false, ignored: false, superseded: true });
});

test('monitorWardenRun handles a run completing naturally during cancellation', async () => {
  const runs = [wardenRun(), wardenRun({ status: 'completed', conclusion: 'success' })];

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => Date.parse('2026-07-21T09:10:00Z'),
    sleep: async () => assert.fail('stale run must attempt cancellation immediately'),
    getRun: async () => runs.shift(),
    getCurrentRun: async () => wardenRun(),
    cancelRun: async () => true,
  });

  assert.deepEqual(result, { cancelled: false, ignored: false });
});

test('monitorWardenRun reports a completed cancellation', async () => {
  const runs = [wardenRun(), wardenRun({ status: 'completed', conclusion: 'cancelled' })];

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => Date.parse('2026-07-21T09:10:00Z'),
    sleep: async () => assert.fail('stale run must attempt cancellation immediately'),
    getRun: async () => runs.shift(),
    getCurrentRun: async () => wardenRun(),
    cancelRun: async () => true,
  });

  assert.deepEqual(result, { cancelled: true, ignored: false });
});

test('monitorWardenRun handles a run completing after cancellation is rejected', async () => {
  const runs = [wardenRun(), wardenRun({ status: 'completed', conclusion: 'success' })];

  const result = await monitorWardenRun({
    maxRuntimeSeconds: 600,
    pollSeconds: 15,
    now: () => Date.parse('2026-07-21T09:10:00Z'),
    sleep: async () => assert.fail('stale run must attempt cancellation immediately'),
    getRun: async () => runs.shift(),
    getCurrentRun: async () => wardenRun(),
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
