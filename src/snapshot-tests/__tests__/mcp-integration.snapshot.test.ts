import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMcpSnapshotHarness, type McpSnapshotHarness } from '../mcp-harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';

let harness: McpSnapshotHarness;

beforeAll(async () => {
  harness = await createMcpSnapshotHarness({
    commandResponses: {
      'xcodebuild -version': {
        success: true,
        output: 'Xcode 16.0\nBuild version 16A242d',
      },
      'xcodebuild -showBuildSettings': {
        success: true,
        output:
          'Build settings for action build and target "CalculatorApp":\n' +
          '    PRODUCT_BUNDLE_IDENTIFIER = io.sentry.calculatorapp\n' +
          '    PRODUCT_NAME = CalculatorApp\n',
      },
      'simctl list devices': {
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                name: 'iPhone 16 Pro',
                udid: 'AAAAAAAA-1111-2222-3333-444444444444',
                state: 'Booted',
                isAvailable: true,
              },
              {
                name: 'iPhone 16',
                udid: 'BBBBBBBB-1111-2222-3333-444444444444',
                state: 'Shutdown',
                isAvailable: true,
              },
            ],
          },
        }),
      },
      xcodebuild: { success: true, output: '** BUILD SUCCEEDED **' },
    },
  });
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(() => {
  harness.resetCapturedCommands();
});

describe('MCP Integration Snapshots', () => {
  describe('session-management', () => {
    it('session_show_defaults -- empty', async () => {
      await harness.client.callTool({
        name: 'session_clear_defaults',
        arguments: { all: true },
      });
      const { text, isError } = await harness.callTool('session_show_defaults', {});
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'session-show-defaults--empty');
    });

    it('session_set_defaults -- set scheme', async () => {
      await harness.client.callTool({
        name: 'session_clear_defaults',
        arguments: { all: true },
      });
      const { text, isError } = await harness.callTool('session_set_defaults', {
        scheme: 'CalculatorApp',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'session-set-defaults--scheme');
    });
  });

  describe('error-paths', () => {
    it('build_sim -- missing required params', async () => {
      const { text, isError } = await harness.callTool('build_sim', {});
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'build-sim--missing-params');
    });
  });
});
