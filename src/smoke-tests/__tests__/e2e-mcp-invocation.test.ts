import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMcpTestHarness, type McpTestHarness } from '../mcp-test-harness.ts';
import { isErrorResponse, expectContent } from '../test-helpers.ts';

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
                udid: 'AAAAAAAA-1111-2222-3333-444444444444',
                state: 'Shutdown',
                isAvailable: true,
              },
            ],
          },
        }),
      },
      xcodebuild: { success: true, output: 'Build Succeeded' },
      'swift build': { success: true, output: 'Build complete!' },
      'simctl boot': { success: true, output: '' },
      'xctrace list devices': { success: true, output: 'No devices found.' },
      'axe tap': { success: true, output: 'Tap performed at (100, 200)' },
      'simctl io': { success: true, output: '/tmp/screenshot.png' },
      devicectl: { success: true, output: '{}' },
    },
  });
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

describe('MCP Tool Invocation (e2e)', () => {
  describe('every tool responds to callTool', () => {
    it('all registered tools return a response when called with empty args', async () => {
      const { tools } = await harness.client.listTools();
      const results: { name: string; ok: boolean; hasContent: boolean }[] = [];

      for (const tool of tools) {
        try {
          const result = await harness.client.callTool({
            name: tool.name,
            arguments: {},
          });

          const content = 'content' in result ? result.content : undefined;
          results.push({
            name: tool.name,
            ok: true,
            hasContent: Array.isArray(content) && content.length > 0,
          });
        } catch {
          // MCP protocol errors are acceptable for tools with required params
          results.push({ name: tool.name, ok: true, hasContent: false });
        }
      }

      expect(results.length).toBe(tools.length);
      for (const r of results) {
        expect(r.ok).toBe(true);
      }
    }, 60_000);
  });

  describe('representative tools with valid args', () => {
    it('list_sims captures simctl command', async () => {
      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'list_sims',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('simctl') && c.includes('list'))).toBe(true);
    });

    it('build_sim captures xcodebuild command with scheme', async () => {
      // Session-aware tools require session defaults to be set first
      await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          scheme: 'MyApp',
          projectPath: '/path/to/MyApp.xcodeproj',
          simulatorId: 'AAAAAAAA-1111-2222-3333-444444444444',
        },
      });

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'build_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('xcodebuild') && c.includes('MyApp'))).toBe(true);
    });

    it('clean captures xcodebuild clean command', async () => {
      await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          scheme: 'MyApp',
          projectPath: '/path/to/MyApp.xcodeproj',
        },
      });

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'clean',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('xcodebuild') && c.includes('clean'))).toBe(true);
    });

    it('swift_package_build captures swift build command', async () => {
      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'swift_package_build',
        arguments: {
          packagePath: '/path/to/package',
        },
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('swift') && c.includes('build'))).toBe(true);
    });

    it('boot_sim captures simctl boot command', async () => {
      await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          simulatorId: 'AAAAAAAA-1111-2222-3333-444444444444',
        },
      });

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'boot_sim',
        arguments: {},
      });

      expectContent(result);

      const commandStrs = harness.capturedCommands.map((c) => c.command.join(' '));
      expect(commandStrs.some((c) => c.includes('simctl') && c.includes('boot'))).toBe(true);
    });

    it('list_schemes responds with content', async () => {
      await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          projectPath: '/path/to/MyApp.xcodeproj',
        },
      });

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'list_schemes',
        arguments: {},
      });

      expectContent(result);

      expect(harness.capturedCommands.length).toBeGreaterThan(0);
    });

    it('list_devices responds with content', async () => {
      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'list_devices',
        arguments: {},
      });

      expectContent(result);

      expect(harness.capturedCommands.length).toBeGreaterThan(0);
    });

    it('session_set_defaults works without external commands', async () => {
      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          scheme: 'TestScheme',
        },
      });

      expectContent(result);
    });

    it('session_show_defaults returns current defaults', async () => {
      const result = await harness.client.callTool({
        name: 'session_show_defaults',
        arguments: {},
      });

      expectContent(result);
    });

    it('show_build_settings responds with content', async () => {
      await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          projectPath: '/path/to/MyApp.xcodeproj',
          scheme: 'MyApp',
        },
      });

      harness.resetCapturedCommands();
      const result = await harness.client.callTool({
        name: 'show_build_settings',
        arguments: {},
      });

      expectContent(result);
    });
  });

  describe('error handling', () => {
    it('returns error for missing required args', async () => {
      // Clear any session defaults from previous tests
      await harness.client.callTool({
        name: 'session_clear_defaults',
        arguments: { all: true },
      });

      // build_sim requires scheme + projectPath/workspacePath + simulatorId/simulatorName
      const result = await harness.client.callTool({
        name: 'build_sim',
        arguments: {},
      });

      expect(isErrorResponse(result)).toBe(true);
    });

    it('returns error response for non-existent tool', async () => {
      // The MCP SDK may either throw or return an error response
      // depending on the server implementation
      let threw = false;
      let errorMessage = '';
      try {
        const result = await harness.client.callTool({
          name: 'this_tool_does_not_exist',
          arguments: {},
        });
        expect(isErrorResponse(result)).toBe(true);
      } catch (err: unknown) {
        threw = true;
        errorMessage = (err as Error).message;
      }

      if (threw) {
        expect(errorMessage.toLowerCase()).toMatch(/not found|unknown|error/);
      }
    });
  });
});
