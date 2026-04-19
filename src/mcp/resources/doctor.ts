/**
 * Doctor Resource Plugin
 *
 * Provides access to development environment doctor information through MCP resource system.
 * This resource reuses the existing doctor tool logic to maintain consistency.
 */

import { log } from '../../utils/logging/index.ts';
import type { CommandExecutor } from '../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../utils/execution/index.ts';
import { doctorLogic } from '../tools/doctor/doctor.ts';

export async function doctorResourceLogic(
  executor: CommandExecutor = getDefaultCommandExecutor(),
): Promise<{ contents: Array<{ text: string }> }> {
  try {
    log('info', 'Processing doctor resource request');
    const result = await doctorLogic({}, executor);

    if (result.isError) {
      const textItem = result.content.find((i) => i.type === 'text') as
        | { type: 'text'; text: string }
        | undefined;
      const errorText = textItem?.text;
      const errorMessage =
        typeof errorText === 'string' ? errorText : 'Failed to retrieve doctor data';
      log('error', `Error in doctor resource handler: ${errorMessage}`);
      return {
        contents: [
          {
            text: `Error retrieving doctor data: ${errorMessage}`,
          },
        ],
      };
    }

    const allText = result.content
      .filter((i): i is { type: 'text'; text: string } => i.type === 'text')
      .map((i) => i.text)
      .join('\n');
    return {
      contents: [
        {
          text: allText || 'No doctor data available',
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error in doctor resource handler: ${errorMessage}`);

    return {
      contents: [
        {
          text: `Error retrieving doctor data: ${errorMessage}`,
        },
      ],
    };
  }
}

export async function handler(_uri: URL): Promise<{ contents: Array<{ text: string }> }> {
  return doctorResourceLogic();
}
