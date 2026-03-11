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

function mockDeviceListJson(): string {
  return JSON.stringify({
    result: {
      devices: [
        {
          identifier: 'DEVICE-1',
          visibilityClass: 'Default',
          connectionProperties: {
            pairingState: 'paired',
            tunnelState: 'connected',
          },
          deviceProperties: {
            name: 'Cam iPhone',
            platformIdentifier: 'com.apple.platform.iphoneos',
          },
        },
      ],
    },
  });
}

function createSetupFs(opts?: {
  storedConfig?: string;
  projectEntries?: Array<{
    name: string;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
  }>;
}) {
  let storedConfig = opts?.storedConfig ?? '';
  const tempFiles = new Map<string, string>();

  const fs = createMockFileSystemExecutor({
    existsSync: (targetPath) => targetPath === configPath && storedConfig.length > 0,
    stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    readdir: async (targetPath) => {
      if (targetPath === cwd) {
        return (
          opts?.projectEntries ?? [
            {
              name: 'App.xcworkspace',
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
          ]
        );
      }

      return [];
    },
    readFile: async (targetPath) => {
      if (targetPath === configPath) {
        return storedConfig;
      }

      const tempContent = tempFiles.get(targetPath);
      if (tempContent != null) {
        return tempContent;
      }

      throw new Error(`Unexpected read path: ${targetPath}`);
    },
    writeFile: async (targetPath, content) => {
      if (targetPath === configPath) {
        storedConfig = content;
        return;
      }

      tempFiles.set(targetPath, content);
    },
    rm: async (targetPath) => {
      tempFiles.delete(targetPath);
    },
  });

  return {
    fs,
    getStoredConfig: () => storedConfig,
    setTempFile: (targetPath: string, content: string) => {
      tempFiles.set(targetPath, content);
    },
  };
}

function createTestPrompter(): Prompter {
  return {
    selectOne: async <T>(opts: { options: Array<{ value: T }> }) => {
      const preferredOption = opts.options.find((option) => option.value != null);
      return (preferredOption ?? opts.options[0]).value;
    },
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
    const { fs, getStoredConfig, setTempFile } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        setTempFile(command[5], mockDeviceListJson());
        return createMockCommandResponse({
          success: true,
          output: '',
        });
      }

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

    const parsed = parseYaml(getStoredConfig()) as {
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
    expect(parsed.sessionDefaults?.deviceId).toBe('DEVICE-1');
    expect(parsed.sessionDefaults?.simulatorId).toBe('SIM-1');
  });

  it('shows debug-gated workflows when existing config enables debug', async () => {
    const { fs, getStoredConfig, setTempFile } = createSetupFs({
      storedConfig: 'schemaVersion: 1\ndebug: true\n',
    });
    let offeredWorkflowIds: string[] = [];

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        setTempFile(command[5], mockDeviceListJson());
        return createMockCommandResponse({
          success: true,
          output: '',
        });
      }

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
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => {
        const preferredOption = opts.options.find((option) => option.value != null);
        return (preferredOption ?? opts.options[0]).value;
      },
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

    const parsed = parseYaml(getStoredConfig()) as {
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
    const { fs, setTempFile } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        setTempFile(command[5], mockDeviceListJson());
        return createMockCommandResponse({
          success: true,
          output: '',
        });
      }

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
    expect(serverConfig.env.XCODEBUILDMCP_DEVICE_ID).toBe('DEVICE-1');
    expect(serverConfig.env.XCODEBUILDMCP_SIMULATOR_ID).toBe('SIM-1');
    expect(serverConfig.env.XCODEBUILDMCP_SIMULATOR_NAME).toBe('iPhone 15');
  });

  it('does not require simulator or device defaults when selected workflows do not depend on them', async () => {
    const { fs, getStoredConfig } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command.includes('simctl')) {
        throw new Error('simulator lookup should not run for workflows without simulator defaults');
      }

      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        throw new Error('device lookup should not run for workflows without device defaults');
      }

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => {
        const preferredOption = opts.options.find((option) => option.value != null);
        return (preferredOption ?? opts.options[0]).value;
      },
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        const macosOption = opts.options.find((option) => option.value === ('macos' as T));
        return macosOption ? [macosOption.value] : opts.options.map((option) => option.value);
      },
      confirm: async (opts: { defaultValue: boolean }) => opts.defaultValue,
    };

    const result = await runSetupWizard({
      cwd,
      fs,
      executor,
      prompter,
      quietOutput: true,
    });

    expect(result.configPath).toBe(configPath);

    const parsed = parseYaml(getStoredConfig()) as {
      enabledWorkflows?: string[];
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.enabledWorkflows).toEqual(['macos']);
    expect(parsed.sessionDefaults?.workspacePath).toBe('App.xcworkspace');
    expect(parsed.sessionDefaults?.scheme).toBe('App');
    expect(parsed.sessionDefaults?.deviceId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorName).toBeUndefined();
  });

  it('collects a device default without requiring simulator selection when only device-dependent workflows are enabled', async () => {
    const { fs, setTempFile } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command.includes('simctl')) {
        throw new Error('simulator lookup should not run for device-only workflows');
      }

      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        setTempFile(command[5], mockDeviceListJson());
        return createMockCommandResponse({
          success: true,
          output: '',
        });
      }

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => {
        const preferredOption = opts.options.find((option) => option.value != null);
        return (preferredOption ?? opts.options[0]).value;
      },
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        const deviceOption = opts.options.find((option) => option.value === ('device' as T));
        return deviceOption ? [deviceOption.value] : opts.options.map((option) => option.value);
      },
      confirm: async (opts: { defaultValue: boolean }) => opts.defaultValue,
    };

    const result = await runSetupWizard({
      cwd,
      fs,
      executor,
      prompter,
      quietOutput: true,
      outputFormat: 'mcp-json',
    });

    const parsed = JSON.parse(result.mcpConfigJson!) as {
      mcpServers: {
        XcodeBuildMCP: {
          env: Record<string, string>;
        };
      };
    };

    const env = parsed.mcpServers.XcodeBuildMCP.env;
    expect(env.XCODEBUILDMCP_ENABLED_WORKFLOWS).toBe('device');
    expect(env.XCODEBUILDMCP_WORKSPACE_PATH).toBe(path.join(cwd, 'App.xcworkspace'));
    expect(env.XCODEBUILDMCP_SCHEME).toBe('App');
    expect(env.XCODEBUILDMCP_DEVICE_ID).toBe('DEVICE-1');
    expect(env.XCODEBUILDMCP_SIMULATOR_ID).toBeUndefined();
    expect(env.XCODEBUILDMCP_SIMULATOR_NAME).toBeUndefined();
  });

  it('allows clearing an existing simulator default when simulator workflows are enabled', async () => {
    const { fs, getStoredConfig } = createSetupFs({
      storedConfig: `schemaVersion: 1
enabledWorkflows:
  - simulator
sessionDefaults:
  workspacePath: App.xcworkspace
  scheme: App
  simulatorId: SIM-1
  simulatorName: iPhone 15
`,
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

    let selectCallCount = 0;
    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => {
        selectCallCount += 1;
        if (selectCallCount === 3) {
          return opts.options[0].value;
        }
        const preferredOption = opts.options.find((option) => option.value != null);
        return (preferredOption ?? opts.options[0]).value;
      },
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        const simulatorOption = opts.options.find((option) => option.value === ('simulator' as T));
        return simulatorOption
          ? [simulatorOption.value]
          : opts.options.map((option) => option.value);
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

    const parsed = parseYaml(getStoredConfig()) as {
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.sessionDefaults?.simulatorId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorName).toBeUndefined();
  });

  it('continues setup with no default device when no devices are available', async () => {
    const { fs, getStoredConfig } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        return createMockCommandResponse({ success: true, output: '' });
      }

      if (command[0] === 'xcrun' && command[1] === 'xctrace') {
        return createMockCommandResponse({ success: true, output: '' });
      }

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

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => opts.options[0].value,
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        const loggingOption = opts.options.find((option) => option.value === ('logging' as T));
        return loggingOption ? [loggingOption.value] : opts.options.map((option) => option.value);
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

    const parsed = parseYaml(getStoredConfig()) as {
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.sessionDefaults?.deviceId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorName).toBeUndefined();
  });

  it('continues setup with no default device when an existing device default no longer exists', async () => {
    const { fs, getStoredConfig } = createSetupFs({
      storedConfig: `schemaVersion: 1
enabledWorkflows:
  - device
sessionDefaults:
  workspacePath: App.xcworkspace
  scheme: App
  deviceId: DEVICE-OLD
`,
    });

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        return createMockCommandResponse({ success: true, output: '' });
      }

      if (command[0] === 'xcrun' && command[1] === 'xctrace') {
        return createMockCommandResponse({ success: true, output: '' });
      }

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => opts.options[0].value,
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        const deviceOption = opts.options.find((option) => option.value === ('device' as T));
        return deviceOption ? [deviceOption.value] : opts.options.map((option) => option.value);
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

    const parsed = parseYaml(getStoredConfig()) as {
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.sessionDefaults?.deviceId).toBeUndefined();
  });

  it('continues setup with no default device when both discovery commands fail', async () => {
    const { fs, getStoredConfig } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        throw new Error('devicectl unavailable');
      }

      if (command[0] === 'xcrun' && command[1] === 'xctrace') {
        return createMockCommandResponse({ success: false, output: '', error: 'xctrace failed' });
      }

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

      return createMockCommandResponse({
        success: true,
        output: `Information about workspace "App":\n    Schemes:\n        App`,
      });
    };

    const prompter: Prompter = {
      selectOne: async <T>(opts: { options: Array<{ value: T }> }) => opts.options[0].value,
      selectMany: async <T>(opts: { options: Array<{ value: T }> }) => {
        const loggingOption = opts.options.find((option) => option.value === ('logging' as T));
        return loggingOption ? [loggingOption.value] : opts.options.map((option) => option.value);
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

    const parsed = parseYaml(getStoredConfig()) as {
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.sessionDefaults?.deviceId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorName).toBeUndefined();
  });

  it('continues setup with no default simulator when no simulators are available', async () => {
    const { fs, getStoredConfig } = createSetupFs();

    const executor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun' && command[1] === 'devicectl') {
        throw new Error('device lookup should not run for simulator-only workflows');
      }

      if (command.includes('--json')) {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({ devices: {} }),
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
        const simulatorOption = opts.options.find((option) => option.value === ('simulator' as T));
        return simulatorOption
          ? [simulatorOption.value]
          : opts.options.map((option) => option.value);
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

    const parsed = parseYaml(getStoredConfig()) as {
      sessionDefaults?: Record<string, unknown>;
    };

    expect(parsed.sessionDefaults?.simulatorId).toBeUndefined();
    expect(parsed.sessionDefaults?.simulatorName).toBeUndefined();
  });

  it('fails in non-interactive mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    await expect(runSetupWizard()).rejects.toThrow('requires an interactive TTY');
  });
});
