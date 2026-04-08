import { log } from '../logging/index.ts';
import { getUiDebuggerGuardMode } from '../environment.ts';
import type { DebugExecutionState } from './types.ts';
import type { DebuggerManager } from './debugger-manager.ts';

export type GuardResult = {
  blockedMessage?: string;
  warningText?: string;
};

const LOG_PREFIX = '[UI Automation Guard]';

export async function guardUiAutomationAgainstStoppedDebugger(opts: {
  debugger: DebuggerManager;
  simulatorId: string;
  toolName: string;
  mode?: 'error' | 'warn' | 'off';
}): Promise<GuardResult> {
  const mode = opts.mode ?? getUiDebuggerGuardMode();
  if (mode === 'off') return {};

  const session = opts.debugger.findSessionForSimulator(opts.simulatorId);
  if (!session) return {};

  let state: DebugExecutionState;
  try {
    state = await opts.debugger.getExecutionState(session.id);
  } catch (error) {
    log(
      'warn',
      `${LOG_PREFIX} ${opts.toolName}: unable to read execution state for ${session.id}: ${String(error)}`,
    );
    return {};
  }

  if (state.status !== 'stopped') return {};

  const details = buildGuardDetails({
    toolName: opts.toolName,
    simulatorId: opts.simulatorId,
    sessionId: session.id,
    backend: session.backend,
    pid: session.pid,
    state,
  });

  if (mode === 'warn') {
    return { warningText: buildGuardWarning(details) };
  }

  return {
    blockedMessage: `UI automation blocked: app is paused in debugger\n${details}`,
  };
}

function buildGuardDetails(params: {
  toolName: string;
  simulatorId: string;
  sessionId: string;
  backend: string;
  pid: number;
  state: DebugExecutionState;
}): string {
  const stateLabel = formatStateLabel(params.state);
  const lines = [
    `tool=${params.toolName}`,
    `simulatorId=${params.simulatorId}`,
    `debugSessionId=${params.sessionId}`,
    `backend=${params.backend}`,
    `pid=${params.pid}`,
    `state=${stateLabel}`,
  ];

  if (params.state.description) {
    lines.push(`stateDetails=${params.state.description}`);
  }

  lines.push(
    '',
    'Resume execution via debug_continue, remove breakpoints, or detach via debug_detach before using UI tools.',
  );

  return lines.join('\n');
}

function formatStateLabel(state: DebugExecutionState): string {
  if (!state.reason) return state.status;
  return `${state.status} (${state.reason})`;
}

function buildGuardWarning(details: string): string {
  return [
    'Warning: debugger reports the app is paused; UI automation may return empty results.',
    details,
  ].join('\n');
}
