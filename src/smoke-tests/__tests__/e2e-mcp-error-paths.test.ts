import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMcpTestHarness, type McpTestHarness } from '../mcp-test-harness.ts';
import { extractText, isErrorResponse } from '../test-helpers.ts';

let harness: McpTestHarness;

beforeAll(async () => {
  harness = await createMcpTestHarness({
    commandResponses: {
      xcodebuild: {
        success: false,
        output: 'xcodebuild: error: The workspace does not exist.',
      },
    },
  });
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.client.callTool({
    name: 'session_clear_defaults',
    arguments: { all: true },
  });
});

describe('MCP Error Paths (e2e)', () => {
  describe('session defaults edge cases', () => {
    it('session_set_defaults resolves both projectPath and workspacePath by keeping workspacePath', async () => {
      const result = await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: {
          projectPath: '/path/to/MyApp.xcodeproj',
          workspacePath: '/path/to/MyApp.xcworkspace',
        },
      });

      const text = extractText(result);
      expect(text).toContain('keeping workspacePath');
    });

    it('build_sim still errors when only scheme is set without project or simulator', async () => {
      await harness.client.callTool({
        name: 'session_set_defaults',
        arguments: { scheme: 'MyApp' },
      });

      const result = await harness.client.callTool({
        name: 'build_sim',
        arguments: {},
      });

      expect(isErrorResponse(result)).toBe(true);
    });
  });
});
