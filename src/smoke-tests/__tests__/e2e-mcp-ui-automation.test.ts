import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMcpTestHarness, type McpTestHarness } from '../mcp-test-harness.ts';
import { extractText, isErrorResponse, getContent } from '../test-helpers.ts';

const SIM_ID = 'AAAAAAAA-1111-2222-3333-444444444444';

let harness: McpTestHarness;

beforeAll(async () => {
  harness = await createMcpTestHarness({
    commandResponses: {
      'axe tap': { success: true, output: 'Tap performed' },
      'axe swipe': { success: true, output: 'Swipe performed' },
      'axe button': { success: true, output: 'Button pressed' },
      'axe gesture': { success: true, output: 'Gesture performed' },
      'axe key': { success: true, output: 'Key pressed' },
      'axe key-sequence': { success: true, output: 'Key sequence performed' },
      'axe touch': { success: true, output: 'Touch performed' },
      'axe type': { success: true, output: 'Type performed' },
      'axe describe-ui': {
        success: true,
        output: JSON.stringify({ type: 'application', children: [] }),
      },
      'simctl io': { success: true, output: '/tmp/screenshot.png' },
      'simctl list devices': {
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                name: 'iPhone 17 Pro',
                udid: SIM_ID,
                state: 'Booted',
                isAvailable: true,
              },
            ],
          },
        }),
      },
      sips: { success: true, output: '' },
      swift: { success: true, output: '393,852' },
    },
  });
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

async function setSimulatorDefaults(): Promise<void> {
  await harness.client.callTool({
    name: 'session_set_defaults',
    arguments: { simulatorId: SIM_ID },
  });
}

async function clearDefaults(): Promise<void> {
  await harness.client.callTool({
    name: 'session_clear_defaults',
    arguments: { all: true },
  });
}

describe('MCP UI Automation Tools (e2e)', () => {
  describe('tap', () => {
    it('responds via MCP with coordinate tap', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'tap',
        arguments: { x: 100, y: 200 },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with element id tap', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'tap',
        arguments: { id: 'myButton' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with element label tap', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'tap',
        arguments: { label: 'Submit' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('swipe', () => {
    it('responds via MCP with swipe coordinates', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'swipe',
        arguments: { x1: 100, y1: 200, x2: 100, y2: 600 },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with optional duration and delta', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'swipe',
        arguments: { x1: 50, y1: 100, x2: 50, y2: 500, duration: 0.5, delta: 10 },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('button', () => {
    it('responds via MCP with home button press', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'button',
        arguments: { buttonType: 'home' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with lock button press', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'button',
        arguments: { buttonType: 'lock' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('gesture', () => {
    it('responds via MCP with scroll-down gesture', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'gesture',
        arguments: { preset: 'scroll-down' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with swipe-from-left-edge gesture', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'gesture',
        arguments: { preset: 'swipe-from-left-edge' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('key_press', () => {
    it('responds via MCP with key press', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'key_press',
        arguments: { keyCode: 40 },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('key_sequence', () => {
    it('responds via MCP with key sequence', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'key_sequence',
        arguments: { keyCodes: [4, 5, 6, 7] },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('long_press', () => {
    it('responds via MCP with long press', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'long_press',
        arguments: { x: 150, y: 300, duration: 500 },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('screenshot', () => {
    it('responds via MCP with screenshot capture', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'screenshot',
        arguments: {},
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with path return format', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'screenshot',
        arguments: { returnFormat: 'path' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('snapshot_ui', () => {
    it('responds via MCP with UI hierarchy', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'snapshot_ui',
        arguments: {},
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('touch', () => {
    it('responds via MCP with touch down+up', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'touch',
        arguments: { x: 200, y: 400, down: true, up: true },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });

    it('responds via MCP with touch down only', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'touch',
        arguments: { x: 200, y: 400, down: true },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('type_text', () => {
    it('responds via MCP with text typing', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'type_text',
        arguments: { text: 'Hello World' },
      });

      const content = getContent(result);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('error paths', () => {
    it('returns error when simulatorId session default is missing', async () => {
      await clearDefaults();

      const result = await harness.client.callTool({
        name: 'tap',
        arguments: { x: 100, y: 200 },
      });

      expect(isErrorResponse(result)).toBe(true);
      const text = extractText(result);
      expect(text.toLowerCase()).toMatch(/simulatorid|required|missing|provide/);
    });

    it('returns error for touch with neither down nor up', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'touch',
        arguments: { x: 100, y: 200 },
      });

      expect(isErrorResponse(result)).toBe(true);
    });

    it('returns error for tap with no target specified', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'tap',
        arguments: {},
      });

      expect(isErrorResponse(result)).toBe(true);
    });

    it('returns error for type_text with empty text', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'type_text',
        arguments: { text: '' },
      });

      expect(isErrorResponse(result)).toBe(true);
    });

    it('returns error for key_sequence with empty keyCodes array', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'key_sequence',
        arguments: { keyCodes: [] },
      });

      expect(isErrorResponse(result)).toBe(true);
    });

    it('returns error for swipe with missing coordinates', async () => {
      await setSimulatorDefaults();
      harness.resetCapturedCommands();

      const result = await harness.client.callTool({
        name: 'swipe',
        arguments: {},
      });

      expect(isErrorResponse(result)).toBe(true);
    });
  });
});
