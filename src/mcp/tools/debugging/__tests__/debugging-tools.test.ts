import { describe, it, expect, beforeEach } from 'vitest';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { DebuggerManager, type DebuggerToolContext } from '../../../../utils/debugger/index.ts';
import type { DebuggerBackend } from '../../../../utils/debugger/backends/DebuggerBackend.ts';
import type { BreakpointSpec, DebugSessionInfo } from '../../../../utils/debugger/types.ts';

import {
  schema as attachSchema,
  handler as attachHandler,
  debug_attach_simLogic,
} from '../debug_attach_sim.ts';
import {
  schema as bpAddSchema,
  handler as bpAddHandler,
  debug_breakpoint_addLogic,
} from '../debug_breakpoint_add.ts';
import {
  schema as bpRemoveSchema,
  handler as bpRemoveHandler,
  debug_breakpoint_removeLogic,
} from '../debug_breakpoint_remove.ts';
import {
  schema as continueSchema,
  handler as continueHandler,
  debug_continueLogic,
} from '../debug_continue.ts';
import {
  schema as detachSchema,
  handler as detachHandler,
  debug_detachLogic,
} from '../debug_detach.ts';
import {
  schema as lldbSchema,
  handler as lldbHandler,
  debug_lldb_commandLogic,
} from '../debug_lldb_command.ts';
import {
  schema as stackSchema,
  handler as stackHandler,
  debug_stackLogic,
} from '../debug_stack.ts';
import {
  schema as variablesSchema,
  handler as variablesHandler,
  debug_variablesLogic,
} from '../debug_variables.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

function createMockBackend(overrides: Partial<DebuggerBackend> = {}): DebuggerBackend {
  return {
    kind: 'dap',
    attach: async () => {},
    detach: async () => {},
    runCommand: async () => 'mock output',
    resume: async () => {},
    addBreakpoint: async (spec: BreakpointSpec) => ({
      id: 1,
      spec,
      rawOutput: 'Breakpoint 1: mock',
    }),
    removeBreakpoint: async () => 'removed',
    getStack: async () => 'frame #0: mock stack',
    getVariables: async () => 'x = 42',
    getExecutionState: async () => ({ status: 'stopped' as const }),
    dispose: async () => {},
    ...overrides,
  };
}

function createTestDebuggerManager(
  backendOverrides: Partial<DebuggerBackend> = {},
): DebuggerManager {
  const backend = createMockBackend(backendOverrides);
  return new DebuggerManager({
    backendFactory: async () => backend,
  });
}

function createTestContext(backendOverrides: Partial<DebuggerBackend> = {}): DebuggerToolContext {
  return {
    executor: createMockExecutor({ success: true, output: '' }),
    debugger: createTestDebuggerManager(backendOverrides),
  };
}

async function createSessionAndContext(
  backendOverrides: Partial<DebuggerBackend> = {},
): Promise<{ ctx: DebuggerToolContext; session: DebugSessionInfo }> {
  const ctx = createTestContext(backendOverrides);
  const session = await ctx.debugger.createSession({
    simulatorId: 'test-sim-uuid',
    pid: 1234,
  });
  ctx.debugger.setCurrentSession(session.id);
  return { ctx, session };
}

// ---------------------------------------------------------------------------
// debug_attach_sim
// ---------------------------------------------------------------------------
describe('debug_attach_sim', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof attachHandler).toBe('function');
    });

    it('should expose schema with expected shape', () => {
      expect(attachSchema).toBeDefined();
    });
  });

  describe('Handler Requirements', () => {
    it('should return error when no session defaults for simulator', async () => {
      const result = await attachHandler({
        bundleId: 'com.test.app',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain('simulatorId');
    });
  });

  describe('Logic Behavior', () => {
    it('should attach successfully with pid', async () => {
      const ctx = createTestContext();

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorId: 'test-sim-uuid',
            pid: 1234,
            continueOnAttach: true,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Attached');
      expect(text).toContain('1234');
      expect(text).toContain('test-sim-uuid');
      expect(text).toContain('Debug session ID');
    });

    it('should attach without continuing when continueOnAttach is false', async () => {
      const ctx = createTestContext();

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorId: 'test-sim-uuid',
            pid: 1234,
            continueOnAttach: false,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Execution is paused');
    });

    it('should return error when createSession throws', async () => {
      const ctx = createTestContext({
        attach: async () => {
          throw new Error('LLDB attach failed');
        },
      });

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorId: 'test-sim-uuid',
            pid: 1234,
            continueOnAttach: true,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to attach debugger');
      expect(text).toContain('LLDB attach failed');
    });

    it('should return error when resume throws after attach', async () => {
      const ctx = createTestContext({
        resume: async () => {
          throw new Error('Resume failed');
        },
      });

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorId: 'test-sim-uuid',
            pid: 1234,
            continueOnAttach: true,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to resume debugger after attach');
    });

    it('should return error when simulator resolution fails', async () => {
      const ctx: DebuggerToolContext = {
        executor: createMockExecutor({
          success: false,
          error: 'No simulators found',
        }),
        debugger: createTestDebuggerManager(),
      };

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorName: 'NonExistent Simulator',
            bundleId: 'com.test.app',
            continueOnAttach: true,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should return error when pid resolution fails for bundleId', async () => {
      const ctx: DebuggerToolContext = {
        executor: createMockExecutor({
          success: false,
          error: 'launchctl failed',
        }),
        debugger: createTestDebuggerManager(),
      };

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorId: 'test-sim-uuid',
            bundleId: 'com.test.app',
            continueOnAttach: true,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to resolve simulator PID');
    });

    it('should include nextStepParams on success', async () => {
      const ctx = createTestContext();

      const result = await runLogic(() =>
        debug_attach_simLogic(
          {
            simulatorId: 'test-sim-uuid',
            pid: 1234,
            continueOnAttach: true,
            makeCurrent: true,
          },
          ctx,
        ),
      );

      expect(result.nextStepParams).toBeDefined();
      const breakpointStep = result.nextStepParams?.debug_breakpoint_add;
      const continueStep = result.nextStepParams?.debug_continue;
      const stackStep = result.nextStepParams?.debug_stack;

      expect(Array.isArray(breakpointStep)).toBe(false);
      expect(Array.isArray(continueStep)).toBe(false);
      expect(Array.isArray(stackStep)).toBe(false);

      const breakpointParams = Array.isArray(breakpointStep) ? undefined : breakpointStep;
      const continueParams = Array.isArray(continueStep) ? undefined : continueStep;
      const stackParams = Array.isArray(stackStep) ? undefined : stackStep;

      const debugSessionId = breakpointParams?.debugSessionId;
      expect(typeof debugSessionId).toBe('string');
      expect(breakpointParams).toMatchObject({ file: '...', line: 123 });
      expect(continueParams?.debugSessionId).toBe(debugSessionId);
      expect(stackParams?.debugSessionId).toBe(debugSessionId);
    });
  });
});

// ---------------------------------------------------------------------------
// debug_breakpoint_add
// ---------------------------------------------------------------------------
describe('debug_breakpoint_add', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof bpAddHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(bpAddSchema).toBeDefined();
      expect('debugSessionId' in bpAddSchema).toBe(true);
      expect('file' in bpAddSchema).toBe(true);
      expect('line' in bpAddSchema).toBe(true);
      expect('function' in bpAddSchema).toBe(true);
      expect('condition' in bpAddSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should add file-line breakpoint successfully', async () => {
      const { ctx, session } = await createSessionAndContext();

      const result = await runLogic(() =>
        debug_breakpoint_addLogic(
          { debugSessionId: session.id, file: 'main.swift', line: 42 },
          ctx,
        ),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should add function breakpoint successfully', async () => {
      const { ctx, session } = await createSessionAndContext();

      const result = await runLogic(() =>
        debug_breakpoint_addLogic({ debugSessionId: session.id, function: 'viewDidLoad' }, ctx),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should add breakpoint with condition', async () => {
      const { ctx, session } = await createSessionAndContext();

      const result = await runLogic(() =>
        debug_breakpoint_addLogic(
          {
            debugSessionId: session.id,
            file: 'main.swift',
            line: 10,
            condition: 'x > 5',
          },
          ctx,
        ),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should return error when addBreakpoint throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        addBreakpoint: async () => {
          throw new Error('Invalid file path');
        },
      });

      const result = await runLogic(() =>
        debug_breakpoint_addLogic(
          { debugSessionId: session.id, file: 'missing.swift', line: 1 },
          ctx,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to add breakpoint');
      expect(text).toContain('Invalid file path');
    });

    it('should use current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext();

      const result = await runLogic(() =>
        debug_breakpoint_addLogic({ file: 'main.swift', line: 10 }, ctx),
      );

      expect(result.isError).toBeFalsy();
    });
  });
});

// ---------------------------------------------------------------------------
// debug_breakpoint_remove
// ---------------------------------------------------------------------------
describe('debug_breakpoint_remove', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof bpRemoveHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(bpRemoveSchema).toBeDefined();
      expect('debugSessionId' in bpRemoveSchema).toBe(true);
      expect('breakpointId' in bpRemoveSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should remove breakpoint successfully', async () => {
      const { ctx, session } = await createSessionAndContext();

      const result = await runLogic(() =>
        debug_breakpoint_removeLogic({ debugSessionId: session.id, breakpointId: 1 }, ctx),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should return error when removeBreakpoint throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        removeBreakpoint: async () => {
          throw new Error('Breakpoint not found');
        },
      });

      const result = await runLogic(() =>
        debug_breakpoint_removeLogic({ debugSessionId: session.id, breakpointId: 999 }, ctx),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to remove breakpoint');
      expect(text).toContain('Breakpoint not found');
    });

    it('should use current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext();

      const result = await runLogic(() => debug_breakpoint_removeLogic({ breakpointId: 1 }, ctx));

      expect(result.isError).toBeFalsy();
    });
  });
});

// ---------------------------------------------------------------------------
// debug_continue
// ---------------------------------------------------------------------------
describe('debug_continue', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof continueHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(continueSchema).toBeDefined();
      expect('debugSessionId' in continueSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should resume session successfully with explicit id', async () => {
      const { ctx, session } = await createSessionAndContext();

      const result = await runLogic(() => debug_continueLogic({ debugSessionId: session.id }, ctx));

      expect(result.isError).toBeFalsy();
    });

    it('should resume current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext();

      const result = await runLogic(() => debug_continueLogic({}, ctx));

      expect(result.isError).toBeFalsy();
    });

    it('should return error when resume throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        resume: async () => {
          throw new Error('Process terminated');
        },
      });

      const result = await runLogic(() => debug_continueLogic({ debugSessionId: session.id }, ctx));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to resume debugger');
      expect(text).toContain('Process terminated');
    });
  });
});

// ---------------------------------------------------------------------------
// debug_detach
// ---------------------------------------------------------------------------
describe('debug_detach', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof detachHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(detachSchema).toBeDefined();
      expect('debugSessionId' in detachSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should detach session successfully with explicit id', async () => {
      const { ctx, session } = await createSessionAndContext();

      const result = await runLogic(() => debug_detachLogic({ debugSessionId: session.id }, ctx));

      expect(result.isError).toBeFalsy();
    });

    it('should detach current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext();

      const result = await runLogic(() => debug_detachLogic({}, ctx));

      expect(result.isError).toBeFalsy();
    });

    it('should return error when detach throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        detach: async () => {
          throw new Error('Connection lost');
        },
      });

      const result = await runLogic(() => debug_detachLogic({ debugSessionId: session.id }, ctx));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to detach debugger');
      expect(text).toContain('Connection lost');
    });
  });
});

// ---------------------------------------------------------------------------
// debug_lldb_command
// ---------------------------------------------------------------------------
describe('debug_lldb_command', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof lldbHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(lldbSchema).toBeDefined();
      expect('debugSessionId' in lldbSchema).toBe(true);
      expect('command' in lldbSchema).toBe(true);
      expect('timeoutMs' in lldbSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should run command successfully', async () => {
      const { ctx, session } = await createSessionAndContext({
        runCommand: async () => '  frame #0: main\n',
      });

      const result = await runLogic(() =>
        debug_lldb_commandLogic({ debugSessionId: session.id, command: 'bt' }, ctx),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should pass timeoutMs through to runCommand', async () => {
      let receivedOpts: { timeoutMs?: number } | undefined;
      const { ctx, session } = await createSessionAndContext({
        runCommand: async (_cmd: string, opts?: { timeoutMs?: number }) => {
          receivedOpts = opts;
          return 'ok';
        },
      });

      await runLogic(() =>
        debug_lldb_commandLogic(
          { debugSessionId: session.id, command: 'expr x', timeoutMs: 5000 },
          ctx,
        ),
      );

      expect(receivedOpts?.timeoutMs).toBe(5000);
    });

    it('should return error when runCommand throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        runCommand: async () => {
          throw new Error('Command timed out');
        },
      });

      const result = await runLogic(() =>
        debug_lldb_commandLogic({ debugSessionId: session.id, command: 'expr longRunning()' }, ctx),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to run LLDB command');
      expect(text).toContain('Command timed out');
    });

    it('should use current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext({
        runCommand: async () => 'result',
      });

      const result = await runLogic(() => debug_lldb_commandLogic({ command: 'po self' }, ctx));

      expect(result.isError).toBeFalsy();
    });
  });
});

// ---------------------------------------------------------------------------
// debug_stack
// ---------------------------------------------------------------------------
describe('debug_stack', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof stackHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(stackSchema).toBeDefined();
      expect('debugSessionId' in stackSchema).toBe(true);
      expect('threadIndex' in stackSchema).toBe(true);
      expect('maxFrames' in stackSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should return stack output successfully', async () => {
      const stackOutput = '  frame #0: 0x0000 main at main.swift:10\n  frame #1: 0x0001 start\n';
      const { ctx, session } = await createSessionAndContext({
        getStack: async () => stackOutput,
      });

      const result = await runLogic(() => debug_stackLogic({ debugSessionId: session.id }, ctx));

      expect(result.isError).toBeFalsy();
    });

    it('should pass threadIndex and maxFrames through', async () => {
      let receivedOpts: { threadIndex?: number; maxFrames?: number } | undefined;
      const { ctx, session } = await createSessionAndContext({
        getStack: async (opts?: { threadIndex?: number; maxFrames?: number }) => {
          receivedOpts = opts;
          return 'frame #0';
        },
      });

      await runLogic(() =>
        debug_stackLogic({ debugSessionId: session.id, threadIndex: 2, maxFrames: 5 }, ctx),
      );

      expect(receivedOpts?.threadIndex).toBe(2);
      expect(receivedOpts?.maxFrames).toBe(5);
    });

    it('should return error when getStack throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        getStack: async () => {
          throw new Error('Process not stopped');
        },
      });

      const result = await runLogic(() => debug_stackLogic({ debugSessionId: session.id }, ctx));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to get stack');
      expect(text).toContain('Process not stopped');
    });

    it('should use current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext({
        getStack: async () => 'frame #0: main',
      });

      const result = await runLogic(() => debug_stackLogic({}, ctx));

      expect(result.isError).toBeFalsy();
    });
  });
});

// ---------------------------------------------------------------------------
// debug_variables
// ---------------------------------------------------------------------------
describe('debug_variables', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof variablesHandler).toBe('function');
    });

    it('should expose schema with expected keys', () => {
      expect(variablesSchema).toBeDefined();
      expect('debugSessionId' in variablesSchema).toBe(true);
      expect('frameIndex' in variablesSchema).toBe(true);
    });
  });

  describe('Logic Behavior', () => {
    it('should return variables output successfully', async () => {
      const variablesOutput = '  (Int) x = 42\n  (String) name = "hello"\n';
      const { ctx, session } = await createSessionAndContext({
        getVariables: async () => variablesOutput,
      });

      const result = await runLogic(() =>
        debug_variablesLogic({ debugSessionId: session.id }, ctx),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should pass frameIndex through', async () => {
      let receivedOpts: { frameIndex?: number } | undefined;
      const { ctx, session } = await createSessionAndContext({
        getVariables: async (opts?: { frameIndex?: number }) => {
          receivedOpts = opts;
          return 'x = 1';
        },
      });

      await runLogic(() =>
        debug_variablesLogic({ debugSessionId: session.id, frameIndex: 3 }, ctx),
      );

      expect(receivedOpts?.frameIndex).toBe(3);
    });

    it('should return error when getVariables throws', async () => {
      const { ctx, session } = await createSessionAndContext({
        getVariables: async () => {
          throw new Error('Frame index out of range');
        },
      });

      const result = await runLogic(() =>
        debug_variablesLogic({ debugSessionId: session.id, frameIndex: 999 }, ctx),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to get variables');
      expect(text).toContain('Frame index out of range');
    });

    it('should use current session when debugSessionId is omitted', async () => {
      const { ctx } = await createSessionAndContext({
        getVariables: async () => 'y = 99',
      });

      const result = await runLogic(() => debug_variablesLogic({}, ctx));

      expect(result.isError).toBeFalsy();
    });
  });
});
