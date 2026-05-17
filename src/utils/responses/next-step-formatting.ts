import type { RuntimeKind } from '../../runtime/types.ts';
import type { NextStep } from '../../types/common.ts';
import { toKebabCase } from '../../runtime/naming.ts';
import { shellEscapeArg } from '../shell-escape.ts';

export interface FormatNextStepOptions {
  runtime: RuntimeKind;
}

const SHELL_SAFE_UNQUOTED_ARG = /^[A-Za-z0-9_@%+=:,./~-]+$/;

function resolveLabel(step: NextStep): string {
  const label = step.label?.trim();
  if (label) return label;
  if (step.tool) return step.tool;
  if (step.cliTool) return step.cliTool;
  return 'Next action';
}

function formatCliArg(value: string): string {
  return SHELL_SAFE_UNQUOTED_ARG.test(value) && !value.startsWith('-')
    ? value
    : shellEscapeArg(value);
}

function formatNextStepForCli(step: NextStep): string {
  const commandName = step.cliTool ?? (step.tool ? toKebabCase(step.tool) : undefined);
  if (!commandName) {
    return resolveLabel(step);
  }

  const parts = ['xcodebuildmcp'];
  if (step.workflow) {
    parts.push(step.workflow);
  }
  parts.push(commandName);

  for (const [key, value] of Object.entries(step.params ?? {})) {
    const flagName = toKebabCase(key);
    if (typeof value === 'boolean') {
      if (value) {
        parts.push(`--${flagName}`);
      }
    } else {
      parts.push(`--${flagName}`, formatCliArg(String(value)));
    }
  }

  return parts.join(' ');
}

function formatMcpValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatNextStepForMcp(step: NextStep): string {
  if (!step.tool) {
    return resolveLabel(step);
  }

  const paramEntries = Object.entries(step.params ?? {});
  if (paramEntries.length === 0) {
    return `${step.tool}()`;
  }

  const paramsStr = paramEntries
    .map(([key, value]) => `${key}: ${formatMcpValue(value)}`)
    .join(', ');

  return `${step.tool}({ ${paramsStr} })`;
}

export function formatNextStep(step: NextStep, options: FormatNextStepOptions): string {
  const formatted =
    options.runtime === 'cli' ? formatNextStepForCli(step) : formatNextStepForMcp(step);

  const label = resolveLabel(step);
  if (!step.label?.trim() || formatted === label) {
    return formatted;
  }

  return `${label}: ${formatted}`;
}

export function serializeNextSteps(
  nextSteps: readonly NextStep[] | undefined,
  options: FormatNextStepOptions,
): string[] | undefined {
  if (!nextSteps || nextSteps.length === 0) {
    return undefined;
  }

  const serialized = [...nextSteps]
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((step) => formatNextStep(step, options))
    .filter((step) => step.trim().length > 0);

  return serialized.length > 0 ? serialized : undefined;
}
