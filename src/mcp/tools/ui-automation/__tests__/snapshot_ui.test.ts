import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { createMockExecutor, createNoopExecutor } from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import type { DebuggerBackend } from '../../../../utils/debugger/backends/DebuggerBackend.ts';
import { DebuggerManager } from '../../../../utils/debugger/debugger-manager.ts';
import { schema, handler, snapshot_uiLogic } from '../snapshot_ui.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import {
  allText,
  callHandler,
  createMockToolHandlerContext,
  runLogic,
} from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';

async function createStoppedDebuggerManager(simulatorId: string): Promise<DebuggerManager> {
  const backend: DebuggerBackend = {
    kind: 'lldb-cli',
    attach: async () => {},
    detach: async () => {},
    runCommand: async () => '',
    resume: async () => {},
    addBreakpoint: async (spec) => ({ id: 1, spec, rawOutput: '' }),
    removeBreakpoint: async () => '',
    getStack: async () => '',
    getVariables: async () => '',
    getExecutionState: async () => ({ status: 'stopped', reason: 'breakpoint' }),
    dispose: async () => {},
  };
  const manager = new DebuggerManager({ backendFactory: async () => backend });
  const session = await manager.createSession({ simulatorId, pid: 12345 });
  manager.setCurrentSession(session.id);
  return manager;
}

describe('Snapshot UI Plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose public schema without simulatorId field', () => {
      const schemaObject = z.object(schema);

      expect(schemaObject.safeParse({}).success).toBe(true);
      expect(schemaObject.safeParse({ sinceScreenHash: 'screen-hash' }).success).toBe(true);

      const withSimId = schemaObject.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as any)).toBe(false);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should surface session default requirement when simulatorId is missing', async () => {
      const result = await callHandler(handler, {});

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Missing required session defaults');
      expect(allText(result)).toContain('simulatorId is required');
    });

    it('should handle invalid simulatorId format via schema validation', async () => {
      // Test the actual handler with invalid UUID format
      const result = await callHandler(handler, {
        simulatorId: 'invalid-uuid-format',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain('Invalid Simulator UUID format');
    });

    it('should return success for valid snapshot_ui execution', async () => {
      const uiHierarchy =
        '{"elements": [{"type": "Button", "frame": {"x": 100, "y": 200, "width": 50, "height": 30}}]}';

      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      // Wrap executor to track calls
      const executorCalls: any[] = [];
      const trackingExecutor: CommandExecutor = async (...args) => {
        executorCalls.push(args);
        return mockExecutor(...args);
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, result, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(executorCalls[0]).toEqual([
        ['/usr/local/bin/axe', 'describe-ui', '--udid', '12345678-1234-4234-8234-123456789012'],
        '[AXe]: describe-ui',
        false,
        { env: {} },
      ]);

      expect(result.isError()).toBe(false);
      expect(ctx.structuredOutput?.schemaVersion).toBe('2');
      expect(ctx.structuredOutput?.result.kind).toBe('capture-result');
      const capture =
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.capture
          : undefined;
      expect(capture).toEqual(
        expect.objectContaining({
          type: 'runtime-snapshot',
          protocol: 'rs/1',
          simulatorId: '12345678-1234-4234-8234-123456789012',
          screenHash: expect.any(String),
          seq: 1,
          elements: [
            expect.objectContaining({
              ref: 'e1',
              role: 'button',
              frame: { x: 100, y: 200, width: 50, height: 30 },
              state: { enabled: true, visible: true },
              actions: expect.arrayContaining(['tap']),
            }),
          ],
        }),
      );
      expect(
        capture && 'type' in capture && capture.type === 'runtime-snapshot' ? capture.actions : [],
      ).toContainEqual({ action: 'tap', elementRef: 'e1' });
      expect(
        capture && 'type' in capture && capture.type === 'runtime-snapshot'
          ? 'rawNode' in capture.elements[0]!
          : true,
      ).toBe(false);
      const storedSnapshot = getRuntimeSnapshot('12345678-1234-4234-8234-123456789012');
      expect(storedSnapshot?.payload).toBe(capture);
      const elementRef =
        capture && 'type' in capture && capture.type === 'runtime-snapshot'
          ? capture.elements[0]?.ref
          : undefined;
      expect(ctx.nextSteps).toEqual([
        {
          label: 'Refresh after layout changes',
          tool: 'snapshot_ui',
          params: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        },
        {
          label: 'Wait for UI to settle',
          tool: 'wait_for_ui',
          params: {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            predicate: 'settled',
          },
        },
        {
          label: 'Tap an elementRef',
          tool: 'tap',
          params: {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            elementRef,
          },
        },
      ]);
    });

    it('should return unchanged capture when sinceScreenHash matches the current screen hash', async () => {
      const uiHierarchy =
        '{"elements": [{"type": "Button", "frame": {"x": 100, "y": 200, "width": 50, "height": 30}}]}';
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const first = createMockToolHandlerContext();
      await first.run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );
      const firstCapture =
        first.ctx.structuredOutput?.result.kind === 'capture-result'
          ? first.ctx.structuredOutput.result.capture
          : undefined;
      const screenHash =
        firstCapture && 'screenHash' in firstCapture ? firstCapture.screenHash : undefined;
      expect(screenHash).toEqual(expect.any(String));

      const second = createMockToolHandlerContext();
      await second.run(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            sinceScreenHash: screenHash,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      const capture =
        second.ctx.structuredOutput?.result.kind === 'capture-result'
          ? second.ctx.structuredOutput.result.capture
          : undefined;
      expect(capture).toEqual({
        type: 'runtime-snapshot-unchanged',
        protocol: 'rs/1',
        simulatorId: '12345678-1234-4234-8234-123456789012',
        screenHash,
        seq: 2,
      });
      expect(getRuntimeSnapshot('12345678-1234-4234-8234-123456789012')?.seq).toBe(2);
      expect(second.ctx.nextSteps).toEqual([
        {
          label: 'Refresh after layout changes',
          tool: 'snapshot_ui',
          params: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        },
        {
          label: 'Wait for UI to settle',
          tool: 'wait_for_ui',
          params: {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            predicate: 'settled',
          },
        },
        {
          label: 'Tap an elementRef',
          tool: 'tap',
          params: {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            elementRef: 'e1',
          },
        },
      ]);
    });

    it('should return full runtime snapshot when sinceScreenHash differs from the current screen hash', async () => {
      const uiHierarchy =
        '{"elements": [{"type": "Button", "frame": {"x": 100, "y": 200, "width": 50, "height": 30}}]}';
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            sinceScreenHash: 'different-screen-hash',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      const capture =
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.capture
          : undefined;
      expect(capture).toEqual(
        expect.objectContaining({
          type: 'runtime-snapshot',
          protocol: 'rs/1',
          simulatorId: '12345678-1234-4234-8234-123456789012',
          screenHash: expect.any(String),
          seq: 1,
          elements: [expect.objectContaining({ ref: 'e1' })],
        }),
      );
    });

    it('should omit tap next-step guidance when no tap targets exist', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'StaticText',
            role: 'AXStaticText',
            AXLabel: 'Loading content...',
            frame: { x: 20, y: 100, width: 200, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps).toEqual([
        {
          label: 'Refresh after layout changes',
          tool: 'snapshot_ui',
          params: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        },
        {
          label: 'Wait for UI to settle',
          tool: 'wait_for_ui',
          params: {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            predicate: 'settled',
          },
        },
        {
          label: 'Take screenshot for verification',
          tool: 'screenshot',
          params: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        },
      ]);
    });

    it('should include scroll guidance for generic containers with scroll-view identifiers', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Other',
            role: 'AXGroup',
            AXIdentifier: 'app.mainScrollView',
            frame: { x: 0, y: 0, width: 390, height: 844 },
            children: [
              {
                type: 'StaticText',
                role: 'AXStaticText',
                AXLabel: 'Visible content',
                frame: { x: 20, y: 160, width: 140, height: 24 },
              },
            ],
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Settings',
            AXIdentifier: 'app.settingsButton',
            frame: { x: 320, y: 40, width: 44, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      const capture =
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.capture
          : undefined;
      const scrollElement =
        capture && 'type' in capture && capture.type === 'runtime-snapshot'
          ? capture.elements[0]
          : undefined;
      expect(scrollElement).toEqual(
        expect.objectContaining({
          role: 'scroll-view',
          identifier: 'app.mainScrollView',
          actions: expect.arrayContaining(['swipeWithin']),
        }),
      );
      expect(ctx.nextSteps?.find((step) => step.tool === 'swipe')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        withinElementRef: 'e1',
        direction: 'up',
        distance: 0.5,
      });
    });

    it('should omit root viewport scroll guidance for broad application containers', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Application',
            role: 'AXApplication',
            AXLabel: 'Example',
            frame: { x: 0, y: 0, width: 390, height: 844 },
            children: [
              {
                type: 'Button',
                role: 'AXButton',
                AXLabel: 'Settings',
                frame: { x: 320, y: 40, width: 44, height: 44 },
              },
              {
                type: 'StaticText',
                role: 'AXStaticText',
                AXLabel: 'Additional details below',
                frame: { x: 40, y: 920, width: 220, height: 24 },
              },
            ],
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      const capture =
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.capture
          : undefined;
      const rootElement =
        capture && 'type' in capture && capture.type === 'runtime-snapshot'
          ? capture.elements[0]
          : undefined;
      expect(rootElement).toEqual(
        expect.objectContaining({
          role: 'application',
        }),
      );
      expect(ctx.nextSteps?.find((step) => step.tool === 'swipe')).toBeUndefined();
      expect(ctx.nextSteps?.map((step) => step.tool)).toEqual([
        'snapshot_ui',
        'wait_for_ui',
        'tap',
      ]);
      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e2',
      });
    });

    it('should include scroll guidance before screenshots when scrollable content is present', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'ScrollView',
            role: 'AXScrollArea',
            AXIdentifier: 'app.mainScrollView',
            frame: { x: 0, y: 120, width: 390, height: 600 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Open Details',
            frame: { x: 20, y: 180, width: 200, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'swipe')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        withinElementRef: 'e1',
        direction: 'up',
        distance: 0.5,
      });
      expect(ctx.nextSteps?.map((step) => step.tool)).toEqual([
        'snapshot_ui',
        'wait_for_ui',
        'swipe',
        'tap',
      ]);
    });

    it('should prioritize scroll guidance over screen-changing tap guidance', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'ScrollView',
            role: 'AXScrollArea',
            AXIdentifier: 'app.mainScrollView',
            frame: { x: 0, y: 120, width: 390, height: 600 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Settings',
            AXIdentifier: 'app.settingsButton',
            frame: { x: 320, y: 40, width: 44, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.map((step) => step.tool)).toEqual([
        'snapshot_ui',
        'wait_for_ui',
        'swipe',
        'tap',
      ]);
    });

    it('should prefer foreground container guidance over background controls', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Application',
            role: 'AXApplication',
            AXLabel: 'Example',
            frame: { x: 0, y: 0, width: 390, height: 844 },
            children: [
              {
                type: 'ScrollView',
                role: 'AXScrollArea',
                AXIdentifier: 'app.mainScrollView',
                frame: { x: 0, y: 0, width: 390, height: 844 },
                children: [
                  {
                    type: 'Button',
                    role: 'AXButton',
                    AXLabel: 'Background item, older screen content',
                    frame: { x: 20, y: 100, width: 300, height: 80 },
                  },
                ],
              },
              {
                type: 'ScrollView',
                role: 'AXScrollArea',
                AXIdentifier: 'app.foregroundPanel',
                frame: { x: 0, y: 320, width: 390, height: 524 },
              },
              {
                type: 'Button',
                role: 'AXButton',
                AXLabel: 'Close',
                frame: { x: 320, y: 340, width: 44, height: 44 },
              },
              {
                type: 'TextField',
                role: 'AXTextField',
                AXLabel: 'Search',
                frame: { x: 20, y: 390, width: 300, height: 44 },
              },
              {
                type: 'Button',
                role: 'AXButton',
                AXLabel: 'Foreground result, current panel content',
                frame: { x: 20, y: 450, width: 320, height: 80 },
              },
            ],
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e7',
      });
      expect(ctx.nextSteps?.find((step) => step.tool === 'swipe')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        withinElementRef: 'e4',
        direction: 'up',
        distance: 0.5,
      });
      expect(ctx.nextSteps?.map((step) => step.tool)).toEqual([
        'snapshot_ui',
        'wait_for_ui',
        'tap',
        'swipe',
      ]);
    });

    it('should keep state-changing controls out of generic tap guidance while promoting switch batches', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Reduce Motion',
            AXValue: '0',
            frame: { x: 20, y: 40, width: 300, height: 44 },
          },
          {
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Reduce Transparency',
            AXValue: '0',
            frame: { x: 20, y: 100, width: 300, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'batch')).toEqual({
        label: 'Batch visible switch toggles',
        tool: 'batch',
        params: {
          simulatorId: '12345678-1234-4234-8234-123456789012',
          steps: [
            { action: 'tap', elementRef: 'e1' },
            { action: 'tap', elementRef: 'e2' },
          ],
        },
      });
      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')).toBeUndefined();

      const capture =
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.capture
          : undefined;
      const targets =
        capture && 'type' in capture && capture.type === 'runtime-snapshot' ? capture.actions : [];
      expect(targets).toContainEqual(expect.objectContaining({ action: 'tap', elementRef: 'e1' }));
      expect(targets).toContainEqual(expect.objectContaining({ action: 'tap', elementRef: 'e2' }));
    });

    it('should promote visible switches into batch while keeping generic tap on content', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Remove',
            frame: { x: 20, y: 40, width: 100, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: '°F',
            AXValue: 'selected',
            frame: { x: 20, y: 100, width: 100, height: 44 },
          },
          {
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Already Enabled',
            AXValue: '1',
            AXUniqueId: 'settings.enabledRowSwitch',
            frame: { x: 20, y: 150, width: 300, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Portland, 1:24 PM · Light Rain',
            AXUniqueId: 'app.contentRow',
            frame: { x: 20, y: 210, width: 300, height: 80 },
          },
          {
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Use Celsius',
            AXValue: '0',
            AXUniqueId: 'settings.useCelsiusRowSwitch',
            frame: { x: 20, y: 310, width: 300, height: 44 },
          },
          {
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Severe Weather Alerts',
            AXValue: '0',
            AXUniqueId: 'settings.alertsRowSwitch',
            frame: { x: 20, y: 370, width: 300, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'batch')).toEqual({
        label: 'Batch visible switch toggles',
        tool: 'batch',
        params: {
          simulatorId: '12345678-1234-4234-8234-123456789012',
          steps: [
            { action: 'tap', elementRef: 'e3' },
            { action: 'tap', elementRef: 'e5' },
          ],
        },
      });
      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e4',
      });
    });

    it('should keep single tap guidance without batch when only one safe batch target exists', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Remove',
            frame: { x: 20, y: 40, width: 100, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Portland',
            frame: { x: 20, y: 100, width: 100, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'batch')).toBeUndefined();
      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e2',
      });
    });

    it('should prefer a non-text-field tap target in next steps', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'TextField',
            role: 'AXTextField',
            AXLabel: 'Search',
            frame: { x: 20, y: 40, width: 200, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Submit',
            frame: { x: 20, y: 100, width: 100, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e2',
      });
    });

    it('should prefer a useful digit over calculator utility controls for tap next-step guidance', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'C',
            frame: { x: 20, y: 40, width: 70, height: 70 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: '±',
            frame: { x: 100, y: 40, width: 70, height: 70 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: '%',
            frame: { x: 180, y: 40, width: 70, height: 70 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: '7',
            frame: { x: 20, y: 120, width: 70, height: 70 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e4',
      });
    });

    it('should not promote segmented choices as generic tap next-step guidance', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: '°F',
            AXValue: 'selected',
            frame: { x: 20, y: 40, width: 70, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: '°C',
            AXValue: 'not selected',
            frame: { x: 100, y: 40, width: 70, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')).toBeUndefined();
    });

    it('should skip low-value controls for tap next-step guidance when another tap target exists', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Sheet Grabber',
            frame: { x: 150, y: 10, width: 80, height: 20 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Close',
            frame: { x: 300, y: 40, width: 60, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Clear search',
            frame: { x: 30, y: 90, width: 120, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Berlin, Germany',
            frame: { x: 20, y: 150, width: 320, height: 80 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e4',
      });
    });

    it('should not prefer destructive controls for tap next-step guidance', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Remove',
            AXIdentifier: 'trash',
            frame: { x: 300, y: 180, width: 40, height: 40 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Portland, 1:24 PM · Light Rain',
            frame: { x: 20, y: 140, width: 300, height: 80 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e2',
      });
    });

    it('should not suggest the sheet grabber as a tap next step', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Sheet Grabber',
            frame: { x: 150, y: 10, width: 80, height: 20 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Close',
            frame: { x: 300, y: 40, width: 60, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e2',
      });
    });

    it('should prefer content-rich cards over navigation and state-changing controls for tap next-step guidance', async () => {
      const uiHierarchy = JSON.stringify({
        elements: [
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Portland',
            AXIdentifier: 'app.navigationButton',
            frame: { x: 20, y: 40, width: 160, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'Settings',
            AXIdentifier: 'app.settingsButton',
            frame: { x: 320, y: 40, width: 44, height: 44 },
          },
          {
            type: 'Button',
            role: 'AXButton',
            AXLabel: 'PRECIP., 78%, Next 24 hours',
            AXIdentifier: 'app.summaryCard',
            frame: { x: 20, y: 260, width: 340, height: 140 },
          },
          {
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Severe Weather Alerts',
            AXValue: '0',
            frame: { x: 20, y: 440, width: 300, height: 44 },
          },
        ],
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      __resetRuntimeSnapshotStoreForTests();
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        snapshot_uiLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(ctx.nextSteps?.find((step) => step.tool === 'tap')?.params).toEqual({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        elementRef: 'e3',
      });
      expect(ctx.nextSteps?.find((step) => step.tool === 'batch')).toBeUndefined();
    });

    it('should preserve runtime snapshot store when AXe output cannot be parsed', async () => {
      __resetRuntimeSnapshotStoreForTests();
      const simulatorId = '12345678-1234-4234-8234-123456789012';
      const seededExecutor = createMockExecutor({
        success: true,
        output:
          '{"elements": [{"type": "Button", "frame": {"x": 1, "y": 2, "width": 3, "height": 4}}]}',
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() => snapshot_uiLogic({ simulatorId }, seededExecutor, mockAxeHelpers));
      const previousSnapshot = getRuntimeSnapshot(simulatorId);
      expect(previousSnapshot).not.toBeNull();

      const invalidJsonExecutor = createMockExecutor({
        success: true,
        output: 'not json',
        error: undefined,
        process: { pid: 12345 },
      });
      const { ctx, result, run } = createMockToolHandlerContext();
      await run(() => snapshot_uiLogic({ simulatorId }, invalidJsonExecutor, mockAxeHelpers));

      expect(result.isError()).toBe(true);
      expect(getRuntimeSnapshot(simulatorId)).toBe(previousSnapshot);
      expect(ctx.structuredOutput?.schemaVersion).toBe('2');
      expect(
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.uiError
          : undefined,
      ).toEqual(
        expect.objectContaining({
          code: 'SNAPSHOT_PARSE_FAILED',
          recoveryHint: 'Run snapshot_ui again after the app is fully launched and responsive.',
        }),
      );
    });

    it('should accept empty AXe payloads and replace a prior runtime snapshot', async () => {
      __resetRuntimeSnapshotStoreForTests();
      const simulatorId = '12345678-1234-4234-8234-123456789012';
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };
      const seededExecutor = createMockExecutor({
        success: true,
        output:
          '{"elements": [{"type": "Button", "frame": {"x": 1, "y": 2, "width": 3, "height": 4}}]}',
        error: undefined,
        process: { pid: 12345 },
      });
      await runLogic(() => snapshot_uiLogic({ simulatorId }, seededExecutor, mockAxeHelpers));
      expect(getRuntimeSnapshot(simulatorId)?.payload.elements).toHaveLength(1);

      for (const output of ['[]', '{"elements": []}']) {
        const emptyExecutor = createMockExecutor({
          success: true,
          output,
          error: undefined,
          process: { pid: 12345 },
        });
        const { ctx, result, run } = createMockToolHandlerContext();
        await run(() => snapshot_uiLogic({ simulatorId }, emptyExecutor, mockAxeHelpers));

        expect(result.isError()).toBe(false);
        const capture =
          ctx.structuredOutput?.result.kind === 'capture-result'
            ? ctx.structuredOutput.result.capture
            : undefined;
        expect(capture).toEqual(
          expect.objectContaining({
            type: 'runtime-snapshot',
            elements: [],
            actions: [],
          }),
        );
        expect(getRuntimeSnapshot(simulatorId)?.payload).toBe(capture);
      }
    });

    it('should preserve runtime snapshot store when AXe returns a non-array payload', async () => {
      __resetRuntimeSnapshotStoreForTests();
      const simulatorId = '12345678-1234-4234-8234-123456789012';
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };
      const seededExecutor = createMockExecutor({
        success: true,
        output:
          '{"elements": [{"type": "Button", "frame": {"x": 1, "y": 2, "width": 3, "height": 4}}]}',
        error: undefined,
        process: { pid: 12345 },
      });
      await runLogic(() => snapshot_uiLogic({ simulatorId }, seededExecutor, mockAxeHelpers));
      const previousSnapshot = getRuntimeSnapshot(simulatorId);

      const invalidExecutor = createMockExecutor({
        success: true,
        output: '{}',
        error: undefined,
        process: { pid: 12345 },
      });
      const { ctx, result, run } = createMockToolHandlerContext();
      await run(() => snapshot_uiLogic({ simulatorId }, invalidExecutor, mockAxeHelpers));

      expect(result.isError()).toBe(true);
      expect(
        ctx.structuredOutput?.result.kind === 'capture-result'
          ? ctx.structuredOutput.result.uiError?.code
          : undefined,
      ).toBe('SNAPSHOT_PARSE_FAILED');
      expect(getRuntimeSnapshot(simulatorId)).toBe(previousSnapshot);
    });

    it('should preserve runtime snapshot store when the debugger guard blocks before AXe runs', async () => {
      __resetRuntimeSnapshotStoreForTests();
      const simulatorId = '12345678-1234-4234-8234-123456789012';
      const seededExecutor = createMockExecutor({
        success: true,
        output:
          '{"elements": [{"type": "Button", "frame": {"x": 1, "y": 2, "width": 3, "height": 4}}]}',
        error: undefined,
        process: { pid: 12345 },
      });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };
      await runLogic(() => snapshot_uiLogic({ simulatorId }, seededExecutor, mockAxeHelpers));
      const previousSnapshot = getRuntimeSnapshot(simulatorId);
      const stoppedDebugger = await createStoppedDebuggerManager(simulatorId);
      const guardedExecutor: CommandExecutor = async () => {
        throw new Error('AXe should not run when debugger guard blocks');
      };

      try {
        const { ctx, result, run } = createMockToolHandlerContext();
        await run(() =>
          snapshot_uiLogic({ simulatorId }, guardedExecutor, mockAxeHelpers, stoppedDebugger),
        );

        expect(result.isError()).toBe(true);
        expect(getRuntimeSnapshot(simulatorId)).toBe(previousSnapshot);
        expect(
          ctx.structuredOutput?.result.kind === 'capture-result'
            ? ctx.structuredOutput.result.uiError
            : undefined,
        ).toEqual(
          expect.objectContaining({
            code: 'ACTION_FAILED',
            recoveryHint:
              'Resume execution with debug_continue, remove breakpoints, or detach with debug_detach before retrying UI automation.',
          }),
        );
      } finally {
        await stoppedDebugger.disposeAll();
      }
    });

    it('should handle DependencyError when axe is not available', async () => {
      // Create mock axe helpers that return null for axe path
      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          createNoopExecutor(),
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle AxeError from failed command execution', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'axe command failed',
        process: { pid: 12345 },
      });

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to get accessibility hierarchy.');
      expect(text).toContain('axe command failed');
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = createMockExecutor(new Error('ENOENT: no such file or directory'));

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle unexpected Error objects', async () => {
      const mockExecutor = createMockExecutor(new Error('Unexpected error'));

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle unexpected string errors', async () => {
      const mockExecutor = createMockExecutor('String error');

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: String error');
    });
  });
});
