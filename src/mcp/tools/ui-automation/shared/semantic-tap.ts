import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { executeAxeCommand } from './axe-command.ts';
import type { AxeHelpers } from './axe-command.ts';
import { getRuntimeElementActivationPoint } from './runtime-snapshot.ts';
import type { RuntimeSnapshotElementRecord } from '../../../../types/ui-snapshot.ts';

export interface SemanticTapCommand {
  selectorArgs: string[] | null;
  coordinateArgs: string[];
  primaryArgs: string[];
  targetDescription: string;
  usedSelector: boolean;
}

function axeElementTypeFor(element: RuntimeSnapshotElementRecord): string | null {
  switch (element.publicElement.role) {
    case 'button':
      return 'Button';
    case 'cell':
      return 'Cell';
    case 'keyboard-key':
      return 'Key';
    case 'switch':
      return 'Switch';
    case 'tab':
      return 'Tab';
    case 'text-field':
      return 'TextField';
    default:
      return null;
  }
}

export function isRecoverableAxeSelectorError(error: unknown): boolean {
  const messageParts = error instanceof Error ? [error.message] : [String(error)];
  if (typeof error === 'object' && error !== null && 'axeOutput' in error) {
    const { axeOutput } = error as { axeOutput?: unknown };
    if (typeof axeOutput === 'string') {
      messageParts.push(axeOutput);
    }
  }

  const message = messageParts.join('\n');
  return (
    /multiple(?:\s+\(?\d+\)?)?\s+accessibility\s+elements\s+matched/i.test(message) ||
    /no\s+accessibility\s+element\s+matched/i.test(message)
  );
}

function hasDuplicateSelectorMatch(params: {
  element: RuntimeSnapshotElementRecord;
  elements: readonly RuntimeSnapshotElementRecord[];
  selector: 'identifier' | 'label' | 'value';
  value: string;
}): boolean {
  const targetType = axeElementTypeFor(params.element);
  const matches = params.elements.filter((candidate) => {
    if (axeElementTypeFor(candidate) !== targetType) {
      return false;
    }
    return candidate.publicElement[params.selector] === params.value;
  });

  return matches.length > 1;
}

function pickSemanticTapSelectorArgs(params: {
  element: RuntimeSnapshotElementRecord;
  elements: readonly RuntimeSnapshotElementRecord[];
  elementTypeArgs: readonly string[];
  extraArgs: readonly string[];
}): string[] | null {
  const { element, elements, elementTypeArgs, extraArgs } = params;
  const { identifier, label, value } = element.publicElement;

  if (element.publicElement.role === 'switch') return null;
  if (
    identifier &&
    !hasDuplicateSelectorMatch({ element, elements, selector: 'identifier', value: identifier })
  ) {
    return ['tap', '--id', identifier, ...elementTypeArgs, ...extraArgs];
  }
  if (label && !hasDuplicateSelectorMatch({ element, elements, selector: 'label', value: label })) {
    return ['tap', '--label', label, ...elementTypeArgs, ...extraArgs];
  }
  if (value && !hasDuplicateSelectorMatch({ element, elements, selector: 'value', value })) {
    return ['tap', '--value', value, ...elementTypeArgs, ...extraArgs];
  }
  return null;
}

export function createSemanticTapCommand(
  element: RuntimeSnapshotElementRecord,
  elementRef: string,
  extraArgs: readonly string[] = [],
  elements: readonly RuntimeSnapshotElementRecord[] = [element],
): SemanticTapCommand {
  const activationPoint = getRuntimeElementActivationPoint(element);
  const elementType = axeElementTypeFor(element);
  const elementTypeArgs = elementType ? ['--element-type', elementType] : [];
  const coordinateArgs =
    element.publicElement.role === 'switch'
      ? [
          'touch',
          '-x',
          String(activationPoint.x),
          '-y',
          String(activationPoint.y),
          '--down',
          '--up',
        ]
      : ['tap', '-x', String(activationPoint.x), '-y', String(activationPoint.y), ...extraArgs];

  const selectorArgs = pickSemanticTapSelectorArgs({
    element,
    elements,
    elementTypeArgs,
    extraArgs,
  });

  return {
    selectorArgs,
    coordinateArgs,
    primaryArgs: selectorArgs ?? coordinateArgs,
    targetDescription: selectorArgs
      ? `elementRef ${elementRef} semantic selector`
      : `elementRef ${elementRef} activation point (${activationPoint.x}, ${activationPoint.y})`,
    usedSelector: selectorArgs !== null,
  };
}

function readAxeCommandName(args: readonly string[]): string {
  const commandName = args[0];
  if (!commandName) {
    throw new Error('Semantic tap command has no AXe command name.');
  }
  return commandName;
}

export function createSemanticTapBatchSteps(command: SemanticTapCommand): string[] {
  if (command.coordinateArgs[0] !== 'touch') {
    return [command.coordinateArgs.join(' ')];
  }

  const baseArgs = command.coordinateArgs.filter((arg) => arg !== '--down' && arg !== '--up');
  return [`${baseArgs.join(' ')} --down`, `${baseArgs.join(' ')} --up`];
}

export async function executeSemanticTapWithAmbiguityFallback(params: {
  command: SemanticTapCommand;
  simulatorId: string;
  executor: CommandExecutor;
  axeHelpers: AxeHelpers;
}): Promise<void> {
  const { command, simulatorId, executor, axeHelpers } = params;

  try {
    await executeAxeCommand(
      command.primaryArgs,
      simulatorId,
      readAxeCommandName(command.primaryArgs),
      executor,
      axeHelpers,
    );
  } catch (error) {
    if (!command.selectorArgs || !isRecoverableAxeSelectorError(error)) {
      throw error;
    }

    await executeAxeCommand(
      command.coordinateArgs,
      simulatorId,
      readAxeCommandName(command.coordinateArgs),
      executor,
      axeHelpers,
    );
  }
}
