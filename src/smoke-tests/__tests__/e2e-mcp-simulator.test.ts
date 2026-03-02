import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMcpTestHarness, type McpTestHarness } from '../mcp-test-harness.ts';
import { expectContent } from '../test-helpers.ts';

const SIM_UUID = 'AAAAAAAA-1111-4222-A333-444444444444';

let harness: McpTestHarness;

beforeAll(async () => {
  harness = await createMcpTestHarness({
    commandResponses: {
      'simctl list devices': {
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                name: 'iPhone 17 Pro',
                udid: SIM_UUID,
                state: 'Booted',
                isAvailable: true,
              },
            ],
          },
        }),
      },
      'simctl list': {
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                name: 'iPhone 17 Pro',
                udid: SIM_UUID,
                state: 'Booted',
                isAvailable: true,
              },
            ],
          },
        }),
      },
      xcodebuild: {
        success: true,
        output:
          'Build Succeeded\n' +
          'CODESIGNING_FOLDER_PATH = /tmp/Build/Products/Debug-iphonesimulator/MyApp.app\n' +
          'BUILT_PRODUCTS_DIR = /tmp/Build/Products/Debug-iphonesimulator\n' +
          'FULL_PRODUCT_NAME = MyApp.app\n',
      },
      'simctl boot': { success: true, output: '' },
      'simctl io': { success: true, output: '/tmp/screenshot.png' },
      'simctl install': { success: true, output: '' },
      'simctl launch': { success: true, output: 'com.test.MyApp: 12345' },
      'simctl terminate': { success: true, output: '' },
      'simctl erase': { success: true, output: '' },
      'simctl shutdown': { success: true, output: '' },
      'simctl ui': { success: true, output: '' },
      'simctl location': { success: true, output: '' },
      'simctl status_bar': { success: true, output: '' },
      'simctl get_app_container': { success: true, output: '/path/to/MyApp.app' },
      'simctl recordVideo': { success: true, output: '' },
      PlistBuddy: { success: true, output: 'com.test.MyApp' },
      'open -a Simulator': { success: true, output: '' },
      sips: { success: true, output: '' },
      'swift -e': { success: true, output: '400,800' },
      axe: { success: true, output: '' },
    },
  });
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

function setSimulatorSessionDefaults(): Promise<unknown> {
  return harness.client.callTool({
    name: 'session_set_defaults',
    arguments: {
      scheme: 'MyApp',
      projectPath: '/path/to/MyApp.xcodeproj',
      simulatorId: SIM_UUID,
      bundleId: 'com.test.MyApp',
    },
  });
}

describe('MCP Simulator Tool Invocation (e2e)', () => {
  describe('simulator workflow tools', () => {
    it('build_run_sim captures xcodebuild and simctl commands', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'build_run_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('xcodebuild'))).toBe(true);
    });

    it('test_sim captures xcodebuild test command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'test_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('xcodebuild'))).toBe(true);
    });

    it('launch_app_sim captures simctl launch command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'launch_app_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('simctl') && c.includes('launch'))).toBe(true);
    });

    it('stop_app_sim captures simctl terminate command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'stop_app_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('simctl') && c.includes('terminate'))).toBe(true);
    });

    it('install_app_sim responds with content', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'install_app_sim',
        arguments: {
          appPath: '/tmp/Build/Products/Debug-iphonesimulator/MyApp.app',
        },
      });

      expectContent(result);
    });

    it('open_sim captures open command', async () => {
      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'open_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('open') && c.includes('Simulator'))).toBe(true);
    });

    it('record_sim_video responds with content', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'record_sim_video',
        arguments: {
          start: true,
        },
      });

      expectContent(result);
    });

    it('get_sim_app_path captures xcodebuild -showBuildSettings command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'get_sim_app_path',
        arguments: {
          platform: 'iOS Simulator',
        },
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(
        commandStrs.some((c) => c.includes('xcodebuild') && c.includes('-showBuildSettings')),
      ).toBe(true);
    });

    it('screenshot captures simctl io screenshot command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'screenshot',
        arguments: {
          returnFormat: 'path',
        },
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(
        commandStrs.some(
          (c) => c.includes('simctl') && c.includes('io') && c.includes('screenshot'),
        ),
      ).toBe(true);
    });
  });

  describe('simulator-management workflow tools', () => {
    it('erase_sims captures simctl erase command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'erase_sims',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('simctl') && c.includes('erase'))).toBe(true);
    });

    it('set_sim_appearance captures simctl ui command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'set_sim_appearance',
        arguments: {
          mode: 'dark',
        },
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(
        commandStrs.some((c) => c.includes('simctl') && c.includes('ui') && c.includes('dark')),
      ).toBe(true);
    });

    it('set_sim_location captures simctl location set command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'set_sim_location',
        arguments: {
          latitude: 37.7749,
          longitude: -122.4194,
        },
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(
        commandStrs.some(
          (c) => c.includes('simctl') && c.includes('location') && c.includes('set'),
        ),
      ).toBe(true);
    });

    it('reset_sim_location captures simctl location clear command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'reset_sim_location',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(
        commandStrs.some(
          (c) => c.includes('simctl') && c.includes('location') && c.includes('clear'),
        ),
      ).toBe(true);
    });

    it('sim_statusbar captures simctl status_bar command', async () => {
      await setSimulatorSessionDefaults();

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'sim_statusbar',
        arguments: {
          dataNetwork: '5g',
        },
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(
        commandStrs.some(
          (c) => c.includes('simctl') && c.includes('status_bar') && c.includes('5g'),
        ),
      ).toBe(true);
    });
  });
});
