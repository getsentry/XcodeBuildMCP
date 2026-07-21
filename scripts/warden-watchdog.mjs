import process from 'node:process';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export function isPullRequestRun(run) {
  return run.event === 'pull_request';
}

export function runStartTimeMs(run) {
  const startTimeMs = Date.parse(run.created_at);
  if (Number.isNaN(startTimeMs)) {
    throw new Error('Warden run has an invalid start timestamp');
  }
  return startTimeMs;
}

export function runtimeSeconds(run, nowMs) {
  return Math.max(0, Math.floor((nowMs - runStartTimeMs(run)) / 1000));
}

export async function monitorWardenRun({
  getRun,
  getCurrentRun = getRun,
  cancelRun,
  expectedRunAttempt,
  maxRuntimeSeconds,
  pollSeconds,
  now = Date.now,
  sleep = sleepTimer,
}) {
  let run = await getRun();

  if (!isPullRequestRun(run)) {
    return { cancelled: false, ignored: true };
  }

  const monitoredAttempt = expectedRunAttempt ?? run.run_attempt;
  if (run.run_attempt !== monitoredAttempt) {
    throw new Error(`Expected Warden run attempt ${monitoredAttempt}, received ${run.run_attempt}`);
  }

  const deadlineMs = runStartTimeMs(run) + maxRuntimeSeconds * 1000;
  while (run.status !== 'completed') {
    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(pollSeconds * 1000, remainingMs));
    run = await getRun();
  }

  if (run.status === 'completed') {
    return { cancelled: false, ignored: false };
  }

  const currentRun = await getCurrentRun();
  if (currentRun.run_attempt !== monitoredAttempt) {
    return { cancelled: false, ignored: false, superseded: true };
  }

  if (currentRun.status === 'completed') {
    return { cancelled: false, ignored: false };
  }

  const cancellationAccepted = await cancelRun();
  run = await getRun();
  if (run.status === 'completed') {
    return { cancelled: cancellationAccepted && run.conclusion === 'cancelled', ignored: false };
  }

  if (cancellationAccepted) {
    return { cancelled: true, ignored: false };
  }

  throw new Error('Warden run remained active after cancellation was rejected');
}

export async function githubRequest(path, options = {}) {
  const { allowConflict = false, ...requestOptions } = options;
  const response = await globalThis.fetch(`https://api.github.com${path}`, {
    ...requestOptions,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...requestOptions.headers,
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });

  if (!response.ok && !(allowConflict && response.status === 409)) {
    throw new Error(
      `GitHub API ${requestOptions.method ?? 'GET'} ${path} failed: ${response.status}`,
    );
  }

  if (response.status === 202 || response.status === 204) {
    return undefined;
  }

  if (response.status === 409) {
    return null;
  }

  return response.json();
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveIntegerEnvironment(name) {
  const value = Number.parseInt(requiredEnvironment(name), 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function main() {
  const repository = requiredEnvironment('GITHUB_REPOSITORY');
  const runId = positiveIntegerEnvironment('TARGET_RUN_ID');
  const runAttempt = positiveIntegerEnvironment('TARGET_RUN_ATTEMPT');
  const maxRuntimeSeconds = positiveIntegerEnvironment('WARDEN_MAX_RUNTIME_SECONDS');
  requiredEnvironment('GITHUB_TOKEN');

  const result = await monitorWardenRun({
    maxRuntimeSeconds,
    pollSeconds: positiveIntegerEnvironment('WARDEN_POLL_SECONDS'),
    expectedRunAttempt: runAttempt,
    // The generic run endpoint retains attempt 1's created_at across reruns.
    getRun: () =>
      githubRequest(`/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}`),
    getCurrentRun: () => githubRequest(`/repos/${repository}/actions/runs/${runId}`),
    cancelRun: async () => {
      const response = await githubRequest(`/repos/${repository}/actions/runs/${runId}/cancel`, {
        method: 'POST',
        allowConflict: true,
      });
      return response !== null;
    },
  });

  if (result.cancelled) {
    throw new Error(`Cancelled Warden run ${runId} after exceeding ${maxRuntimeSeconds} seconds`);
  }

  if (result.superseded) {
    globalThis.console.log(`Warden run attempt ${runAttempt} was superseded`);
    return;
  }

  globalThis.console.log(result.ignored ? 'Ignored non-PR Warden run' : 'Warden run completed');
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  await main();
}
