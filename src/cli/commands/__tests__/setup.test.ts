import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
} from '../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../utils/CommandExecutor.ts';
import type { Prompter } from '../../interactive/prompts.ts';
import { runSetupWizard } from '../setup.ts';

const cwd = '/repo';
const configPath = path.join(cwd, '.xcodebuildmcp', 'config.yaml');

function createTestPrompter(): Prompter {
  return {
    selectOne: async <T>(opts: { options: Array<{ value: T }> }) => opts.options[0].value,
    selectMany: async <T>(opts: { options: Array<{ value: T }> }) =>
      opts.options.map((option) => option.value),
    confirm: async (opts: { defaultValue: boolean }) => opts.defaultValue,
  };
}

describe('setup command', () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    process.argv = ['node', 'script', 'setup'];
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutIsTTY,
      configurable: true,
    });
  });

  it('exports a setup wizard that writes config selections', async () => {
    let storedConfig = '';

    const fs = createMockFileSystemExecutor({
      existsSync: (targetPath) => targetPath === configPath && storedConfig.length > 0,
      stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
      readdir: async (targetPath) => {
        if (targetPath === cwd) {
          return [
            {
              name: 'App.xcworkspace',
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
          ];
        }

        return [];
      },
      readFile: async (targetPath) => {
        if (targetPath !== configPath) {
          throw new Error(`Unexpected read path: ${targetPath}`);
        }
        return storedConfig;
      },
      writeFile: async (targetPath, content) => {
        if (targetPath !== configPath) {
          throw new Error(`Unexpected write path: ${targetPath}`);
        }
        storedConfig = content;
      },
    });

    const executor: CommandExecutor = async (command) => {
      if (command.includes('--json')) {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({
            devices: {
              'iOS 17.0': [
                {
                  name: 'iPhone 15',
                  udid: 'SIM-1',
                  state: 'Shutdown',
                  isAvailable: true,
                },
              ],
            },
          }),
        });
      }

      if (command[0] === 'xcrun') {
        return createMockCommandResponse({
          success: true,
          output: `== Devices ==\n-- iOS 17.0 --\n    iPhone 15 (SIM-1) (Shutdown)`,
        });
      }

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const result = await runSetupWizard({
      cwd,
      fs,
      executor,
      prompter: createTestPrompter(),
      quietOutput: true,
    });
    expect(result.configPath).toBe(configPath);

    const parsed = parseYaml(storedConfig) as {
      debug?: boolean;
      sentryDisabled?: boolean;
      enabledWorkflows?: string[];
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.enabledWorkflows?.length).toBeGreaterThan(0);
    expect(parsed.enabledWorkflows).not.toContain('doctor');
    expect(parsed.debug).toBe(false);
    expect(parsed.sentryDisabled).toBe(false);
    expect(parsed.sessionDefaults?.workspacePath).toBe('App.xcworkspace');
    expect(parsed.sessionDefaults?.scheme).toBe('App');
    expect(parsed.sessionDefaults?.simulatorId).toBe('SIM-1');
  });

  it('shows debug-gated workflows when existing config enables debug', async () => {
    let storedConfig = 'schemaVersion: 1\ndebug: true\n';
    let offeredWorkflowIds: string[] = [];

    const fs = createMockFileSystemExecutor({
      existsSync: (targetPath) => targetPath === configPath && storedConfig.length > 0,
      stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
      readdir: async (targetPath) => {
        if (targetPath === cwd) {
          return [
            {
              name: 'App.xcworkspace',
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
          ];
        }

        return [];
      },
      readFile: async (targetPath) => {
        if (targetPath !== configPath) {
          throw new Error(`Unexpected read path: ${targetPath}`);
        }
        return storedConfig;
      },
      writeFile: async (targetPath, content) => {
        if (targetPath !== configPath) {
          throw new Error(`Unexpected write path: ${targetPath}`);
        }
        storedConfig = content;
      },
    });

    const executor: CommandExecutor = async (command) => {
      if (command.includes('--json')) {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({
            devices: {
              'iOS 17.0': [
                {
                  name: 'iPhone 15',
                  udid: 'SIM-1',
                  state: 'Shutdown',
                  isAvailable: true,
                },
              ],
            },
          }),
        });
      }

      if (command[0] === 'xcrun') {
        return createMockCommandResponse({
          success: true,
          output: `== Devices ==\n-- iOS 17.0 --\n    iPhone 15 (SIM-1) (Shutdown)`,
        });
      }

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => opts.options[0].value,
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        offeredWorkflowIds = opts.options.map((option) => String(option.value));
        return opts.options.map((option) => option.value);
      },
      confirm: async (opts: { defaultValue: boolean }) => opts.defaultValue,
    };

    await runSetupWizard({
      cwd,
      fs,
      executor,
      prompter,
      quietOutput: true,
    });

    const parsed = parseYaml(storedConfig) as {
      debug?: boolean;
      enabledWorkflows?: string[];
    };

    expect(parsed.debug).toBe(true);
    expect(offeredWorkflowIds).toContain('doctor');
  });

  it('fails fast when Xcode command line tools are unavailable', async () => {
    const failingExecutor: CommandExecutor = async (command) => {
      if (command[0] === 'xcodebuild') {
        return createMockCommandResponse({
          success: false,
          output: '',
          error: 'xcodebuild: command not found',
        });
      }

      return createMockCommandResponse({ success: true, output: '' });
    };

    await expect(
      runSetupWizard({
        cwd,
        fs: createMockFileSystemExecutor(),
        executor: failingExecutor,
        prompter: createTestPrompter(),
        quietOutput: true,
      }),
    ).rejects.toThrow('Setup prerequisites failed');
  });

  it('outputs MCP config JSON when format is mcp-json', async () => {
    const fs = createMockFileSystemExecutor({
      existsSync: () => false,
      stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
      readdir: async (targetPath) => {
        if (targetPath === cwd) {
          return [
            {
              name: 'App.xcworkspace',
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
          ];
        }

        return [];
      },
      readFile: async () => '',
      writeFile: async () => {},
    });

    const executor: CommandExecutor = async (command) => {
      if (command.includes('--json')) {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({
            devices: {
              'iOS 17.0': [
                {
                  name: 'iPhone 15',
                  udid: 'SIM-1',
                  state: 'Shutdown',
                  isAvailable: true,
                },
              ],
            },
          }),
        });
      }

      if (command[0] === 'xcrun') {
        return createMockCommandResponse({
          success: true,
          output: `== Devices ==\n-- iOS 17.0 --\n    iPhone 15 (SIM-1) (Shutdown)`,
        });
      }

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const result = await runSetupWizard({
      cwd,
      fs,
      executor,
      prompter: createTestPrompter(),
      quietOutput: true,
      outputFormat: 'mcp-json',
    });

    expect(result.configPath).toBeUndefined();
    expect(result.mcpConfigJson).toBeDefined();

    const parsed = JSON.parse(result.mcpConfigJson!) as {
      mcpServers: {
        XcodeBuildMCP: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };

    const serverConfig = parsed.mcpServers.XcodeBuildMCP;
    expect(serverConfig.command).toBe('npx');
    expect(serverConfig.args).toEqual(['-y', 'xcodebuildmcp@latest', 'mcp']);
    expect(serverConfig.env.XCODEBUILDMCP_ENABLED_WORKFLOWS).toBeDefined();
    expect(serverConfig.env.XCODEBUILDMCP_WORKSPACE_PATH).toBe(path.join(cwd, 'App.xcworkspace'));
    expect(serverConfig.env.XCODEBUILDMCP_SCHEME).toBe('App');
    expect(serverConfig.env.XCODEBUILDMCP_SIMULATOR_ID).toBe('SIM-1');
    expect(serverConfig.env.XCODEBUILDMCP_SIMULATOR_NAME).toBe('iPhone 15');
  });

  it('fails in non-interactive mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    await expect(runSetupWizard()).rejects.toThrow('requires an interactive TTY');
  });
});
