/**
 * Session Status Resource Plugin
 *
 * Provides read-only runtime session state for log capture and debugging.
 */

import { log } from '../../utils/logging/index.ts';
import { toErrorMessage } from '../../utils/errors.ts';
import { getSessionRuntimeStatusSnapshot } from '../../utils/session-status.ts';

export async function sessionStatusResourceLogic(): Promise<{ contents: Array<{ text: string }> }> {
  try {
    log('info', 'Processing session status resource request');
    const status = await getSessionRuntimeStatusSnapshot();

    return {
      contents: [
        {
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    log('error', `Error in session status resource handler: ${errorMessage}`);

    return {
      contents: [
        {
          text: `Error retrieving session status: ${errorMessage}`,
        },
      ],
    };
  }
}

export async function handler(_uri: URL): Promise<{ contents: Array<{ text: string }> }> {
  return sessionStatusResourceLogic();
}
