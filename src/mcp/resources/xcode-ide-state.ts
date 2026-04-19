/**
 * Xcode IDE State Resource
 *
 * Provides read-only access to Xcode's current IDE selection (scheme and simulator).
 * Reads from UserInterfaceState.xcuserstate without modifying session defaults.
 *
 * Visibility is controlled by the `runningUnderXcodeAgent` predicate in the resource manifest.
 */

import { log } from '../../utils/logging/index.ts';
import { getDefaultCommandExecutor } from '../../utils/execution/index.ts';
import { readXcodeIdeState } from '../../utils/xcode-state-reader.ts';

export interface XcodeIdeStateResponse {
  detected: boolean;
  scheme?: string;
  simulatorId?: string;
  simulatorName?: string;
  error?: string;
}

export async function xcodeIdeStateResourceLogic(): Promise<{
  contents: Array<{ text: string }>;
}> {
  try {
    log('info', 'Processing Xcode IDE state resource request');

    const executor = getDefaultCommandExecutor();
    const cwd = process.cwd();

    const state = await readXcodeIdeState({ executor, cwd });

    const response: XcodeIdeStateResponse = {
      detected: !state.error && (!!state.scheme || !!state.simulatorId),
      scheme: state.scheme,
      simulatorId: state.simulatorId,
      simulatorName: state.simulatorName,
      error: state.error,
    };

    return {
      contents: [
        {
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error in Xcode IDE state resource handler: ${errorMessage}`);

    const response: XcodeIdeStateResponse = {
      detected: false,
      error: errorMessage,
    };

    return {
      contents: [
        {
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
}

export async function handler(_uri: URL): Promise<{ contents: Array<{ text: string }> }> {
  return xcodeIdeStateResourceLogic();
}
