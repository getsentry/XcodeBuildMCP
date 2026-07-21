import process from 'node:process';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const WARDEN_WORKFLOW_NAME = 'Warden';

export function isWardenPullRequestRun(run) {
  return run.name === WARDEN_WORKFLOW_NAME && run.event === 'pull_request';
}

export function runtimeSeconds(run, nowMs) {
  return Math.max(0, Math.floor((nowMs - Date.parse(run.created_at)) / 1000));
}

export async function monitorWardenRun({
  getRun,
  cancelRun,
  maxRuntimeSeconds,
  pollSeconds,
  now = Date.now,
  sleep = sleepTimer,
}) {
  let run = await getRun();

  if (!isWardenPullRequestRun(run)) {
    return { cancelled: false, ignored: true };
  }

  const deadlineMs = Date.parse(run.created_at) + maxRuntimeSeconds * 1000;
  while (run.status !== 'completed' && now() < deadlineMs) {
    await sleep(Math.min(pollSeconds * 1000, deadlineMs - now()));
    run = await getRun();
  }

  if (run.status === 'completed') {
    return { cancelled: false, ignored: false };
  }

  if (await cancelRun()) {
    return { cancelled: true, ignored: false };
  }

  run = await getRun();
  if (run.status === 'completed') {
    return { cancelled: false, ignored: false };
  }

  throw new Error('Warden run remained active after cancellation was rejected');
}

async function githubRequest(path, options = {}) {
  const response = await globalThis.fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`GitHub API ${options.method ?? 'GET'} ${path} failed: ${response.status}`);
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
  const maxRuntimeSeconds = positiveIntegerEnvironment('WARDEN_MAX_RUNTIME_SECONDS');
  requiredEnvironment('GITHUB_TOKEN');

  const result = await monitorWardenRun({
    maxRuntimeSeconds,
    pollSeconds: positiveIntegerEnvironment('WARDEN_POLL_SECONDS'),
    getRun: () => githubRequest(`/repos/${repository}/actions/runs/${runId}`),
    cancelRun: async () => {
      const response = await githubRequest(`/repos/${repository}/actions/runs/${runId}/cancel`, {
        method: 'POST',
      });
      return response !== null;
    },
  });

  if (result.cancelled) {
    throw new Error(`Cancelled Warden run ${runId} after exceeding ${maxRuntimeSeconds} seconds`);
  }

  globalThis.console.log(result.ignored ? 'Ignored non-PR Warden run' : 'Warden run completed');
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  await main();
}
