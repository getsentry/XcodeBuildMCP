import { log } from '../../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../../utils/execution/index.ts';
import { getAxePath, getBundledAxeEnvironment } from '../../../../utils/axe-helpers.ts';
import { DependencyError, AxeError, SystemError } from '../../../../utils/errors.ts';

export interface AxeHelpers {
  getAxePath: () => string | null;
  getBundledAxeEnvironment: () => Record<string, string>;
}

export const defaultAxeHelpers: AxeHelpers = {
  getAxePath,
  getBundledAxeEnvironment,
};

const LOG_PREFIX = '[AXe]';

export async function executeAxeCommand(
  commandArgs: string[],
  simulatorId: string,
  commandName: string,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  axeHelpers: AxeHelpers = defaultAxeHelpers,
): Promise<string> {
  const axeBinary = axeHelpers.getAxePath();
  if (!axeBinary) {
    throw new DependencyError('AXe binary not found');
  }

  const fullArgs = [...commandArgs, '--udid', simulatorId];
  const fullCommand = [axeBinary, ...fullArgs];

  try {
    const axeEnv = axeBinary !== 'axe' ? axeHelpers.getBundledAxeEnvironment() : undefined;

    const result = await executor(
      fullCommand,
      `${LOG_PREFIX}: ${commandName}`,
      false,
      axeEnv ? { env: axeEnv } : undefined,
    );

    if (!result.success) {
      const axeOutput =
        result.error && result.error.trim().length > 0 ? result.error : result.output;
      throw new AxeError(
        `axe command '${commandName}' failed.`,
        commandName,
        axeOutput.trim(),
        simulatorId,
      );
    }

    if (result.error) {
      log(
        'warn',
        `${LOG_PREFIX}: Command '${commandName}' produced stderr output but exited successfully. Output: ${result.error}`,
      );
    }

    return result.output.trim();
  } catch (error) {
    if (error instanceof Error) {
      if (error instanceof AxeError) {
        throw error;
      }
      throw new SystemError(`Failed to execute axe command: ${error.message}`, error);
    }
    throw new SystemError(`Failed to execute axe command: ${String(error)}`);
  }
}
