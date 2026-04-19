/**
 * Simulator Resource Plugin
 *
 * Provides access to available iOS simulators through MCP resource system.
 * This resource reuses the existing list_sims tool logic to maintain consistency.
 */

import { log } from '../../utils/logging/index.ts';
import { getDefaultCommandExecutor } from '../../utils/execution/index.ts';
import type { CommandExecutor } from '../../utils/execution/index.ts';
import { list_simsLogic } from '../tools/simulator/list_sims.ts';
import { createRenderSession } from '../../rendering/render.ts';
import { handlerContextStorage } from '../../utils/typed-tool-factory.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';

export async function simulatorsResourceLogic(
  executor: CommandExecutor = getDefaultCommandExecutor(),
): Promise<{ contents: Array<{ text: string }> }> {
  const session = createRenderSession('text');
  const ctx: ToolHandlerContext = {
    emit: (event) => session.emit(event),
    attach: () => {},
  };

  try {
    log('info', 'Processing simulators resource request');
    await handlerContextStorage.run(ctx, () => list_simsLogic({}, executor));
    const text = session.finalize();
    if (session.isError()) {
      throw new Error(text || 'Failed to retrieve simulator data');
    }
    return {
      contents: [
        {
          text: text || 'No simulator data available',
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error in simulators resource handler: ${errorMessage}`);

    return {
      contents: [
        {
          text: `Error retrieving simulator data: ${errorMessage}`,
        },
      ],
    };
  }
}

export async function handler(_uri: URL): Promise<{ contents: Array<{ text: string }> }> {
  return simulatorsResourceLogic();
}
