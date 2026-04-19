import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  type CommandExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, toggle_software_keyboardLogic } from '../toggle_software_keyboard.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

const BOOTED_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'test-uuid-123', name: 'iPhone 15 Pro', state: 'Booted' },
    ],
  },
});

function fifo(responses: Array<{ success: boolean; output?: string; error?: string }>): {
  executor: CommandExecutor;
  commands: string[][];
} {
  const commands: string[][] = [];
  let i = 0;
  const executor: CommandExecutor = async (command) => {
    commands.push(command);
    const r = responses[i] ?? { success: true, output: '' };
    i += 1;
    return createMockCommandResponse({
      success: r.success,
      output: r.output ?? '',
      error: r.error,
    });
  };
  return { executor, commands };
}

describe('toggle_software_keyboard tool', () => {
  describe('Schema Validation', () => {
    it('exposes public schema without simulatorId field', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      const withSimId = schemaObj.safeParse({ simulatorId: 'test-uuid-123' });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as object)).toBe(false);
    });
  });

  describe('Handler Behavior', () => {
    it('returns success for a booted simulator', async () => {
      const { executor } = fifo([
        { success: true, output: BOOTED_JSON },
        { success: true, output: '' },
        { success: true, output: 'OK' },
        { success: true, output: '' },
      ]);

      const result = await runLogic(() =>
        toggle_software_keyboardLogic({ simulatorId: 'test-uuid-123' }, executor),
      );

      expect(result.isError).toBeFalsy();
    });

    it('returns an error when the simulator is not booted', async () => {
      const { executor } = fifo([
        {
          success: true,
          output: JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
                { udid: 'test-uuid-123', name: 'iPhone 15 Pro', state: 'Shutdown' },
              ],
            },
          }),
        },
      ]);

      const result = await runLogic(() =>
        toggle_software_keyboardLogic({ simulatorId: 'test-uuid-123' }, executor),
      );

      expect(result.isError).toBe(true);
    });

    it('sends Cmd+K keystroke without shift modifier', async () => {
      const { executor, commands } = fifo([
        { success: true, output: BOOTED_JSON },
        { success: true, output: '' },
        { success: true, output: 'OK' },
        { success: true, output: '' },
      ]);

      await runLogic(() =>
        toggle_software_keyboardLogic({ simulatorId: 'test-uuid-123' }, executor),
      );

      const keystroke = commands[3].join(' ');
      expect(keystroke).toContain('keystroke "k"');
      expect(keystroke).toContain('command down');
      expect(keystroke).not.toContain('shift down');
    });

    it('returns error when executor throws', async () => {
      const executor: CommandExecutor = async () => {
        throw new Error('boom');
      };

      const result = await runLogic(() =>
        toggle_software_keyboardLogic({ simulatorId: 'test-uuid-123' }, executor),
      );

      expect(result.isError).toBe(true);
    });
  });
});
