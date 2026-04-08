import type { RuntimeKind } from '../../runtime/types.ts';
import type { NextStep } from '../../types/common.ts';
import { toKebabCase } from '../../runtime/naming.ts';

function resolveLabel(step: NextStep): string {
  if (step.label?.trim()) return step.label;
  if (step.tool) return step.tool;
  if (step.cliTool) return step.cliTool;
  return 'Next action';
}

/**
 * Format a single next step for CLI output.
 * Example: xcodebuildmcp simulator open-sim
 * Example: xcodebuildmcp simulator install-app-sim --simulator-id "ABC123" --app-path "PATH"
 */
function formatNextStepForCli(step: NextStep): string {
  if (!step.tool) {
    return resolveLabel(step);
  }
  const parts = ['xcodebuildmcp'];
  const cliTool = step.cliTool ?? toKebabCase(step.tool);
  const params = step.params ?? {};

  if (step.workflow) {
    parts.push(step.workflow);
  }

  parts.push(cliTool);

  for (const [key, value] of Object.entries(params)) {
    const flagName = toKebabCase(key);
    if (typeof value === 'boolean') {
      if (value) {
        parts.push(`--${flagName}`);
      }
    } else {
      parts.push(`--${flagName} "${String(value)}"`);
    }
  }

  return parts.join(' ');
}

/**
 * Format a single next step for MCP output.
 * Example: open_sim()
 * Example: install_app_sim({ simulatorId: "ABC123", appPath: "PATH" })
 */
function formatNextStepForMcp(step: NextStep): string {
  if (!step.tool) {
    return resolveLabel(step);
  }

  const paramEntries = Object.entries(step.params ?? {});
  if (paramEntries.length === 0) {
    return `${step.tool}()`;
  }

  const paramsStr = paramEntries
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}: "${value}"`;
      }
      return `${key}: ${String(value)}`;
    })
    .join(', ');

  return `${step.tool}({ ${paramsStr} })`;
}

export function renderNextStep(step: NextStep, runtime: RuntimeKind): string {
  if (!step.tool) {
    return resolveLabel(step);
  }
  const formatted = runtime === 'cli' ? formatNextStepForCli(step) : formatNextStepForMcp(step);
  if (!step.label) {
    return formatted;
  }
  return `${step.label}: ${formatted}`;
}

export function renderNextStepsSection(steps: NextStep[], runtime: RuntimeKind): string {
  if (steps.length === 0) {
    return '';
  }

  const sorted = [...steps].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const lines = sorted.map((step, index) => `${index + 1}. ${renderNextStep(step, runtime)}`);

  return `Next steps:\n${lines.join('\n')}`;
}
