import { describe, expect, it } from 'vitest';

import type { DapEvent, DapRequest, DapResponse } from '../../dap/types.ts';
import { createDapBackend } from '../dap-backend.ts';
import {
  createMockExecutor,
  createMockInteractiveSpawner,
  type MockInteractiveSession,
} from '../../../../test-utils/mock-executors.ts';
import type { BreakpointSpec } from '../../types.ts';

type ResponsePlan = {
  body?: Record<string, unknown>;
  events?: DapEvent[];
};

function encodeMessage(message: Record<string, unknown>): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function createDapSpawner(handlers: Record<string, (request: DapRequest) => ResponsePlan>) {
  let buffer = Buffer.alloc(0);
  let responseSeq = 1000;

  return createMockInteractiveSpawner({
    onWrite: (data: string, session: MockInteractiveSession) => {
      buffer = Buffer.concat([buffer, Buffer.from(data, 'utf8')]);
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.slice(0, headerEnd).toString('utf8');
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) return;

        const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
        buffer = buffer.slice(bodyEnd);
        const request = JSON.parse(body) as DapRequest;
        const handler = handlers[request.command];
        if (!handler) {
          throw new Error(`Unexpected DAP request: ${request.command}`);
        }
        const plan = handler(request);
        if (plan.events) {
          for (const event of plan.events) {
            session.stdout.write(encodeMessage(event));
          }
        }
        const response: DapResponse = {
          seq: responseSeq++,
          type: 'response',
          request_seq: request.seq,
          success: true,
          command: request.command,
          body: plan.body,
        };
        session.stdout.write(encodeMessage(response));
      }
    },
  });
}

function createDefaultHandlers() {
  return {
    initialize: () => ({ body: { supportsConfigurationDoneRequest: true } }),
    attach: () => ({ body: {} }),
    configurationDone: () => ({ body: {} }),
    threads: () => ({ body: { threads: [{ id: 1, name: 'main' }] } }),
    stackTrace: () => ({
      body: {
        stackFrames: [
          {
            id: 11,
            name: 'main',
            source: { path: '/tmp/main.swift' },
            line: 42,
          },
        ],
      },
    }),
    scopes: () => ({
      body: {
        scopes: [{ name: 'Locals', variablesReference: 100 }],
      },
    }),
    variables: () => ({
      body: {
        variables: [{ name: 'answer', value: '42', type: 'Int' }],
      },
    }),
    evaluate: () => ({
      body: {
        result: 'ok',
        output: 'evaluated',
      },
    }),
    pause: () => ({
      body: {},
      events: [
        {
          seq: 2000,
          type: 'event',
          event: 'stopped',
          body: { reason: 'pause', threadId: 1 },
        },
      ],
    }),
    setBreakpoints: (request: DapRequest) => {
      const args = request.arguments as { breakpoints: Array<{ line: number }> };
      const breakpoints = (args?.breakpoints ?? []).map((bp, index) => ({
        id: 100 + index,
        line: bp.line,
        verified: true,
      }));
      return { body: { breakpoints } };
    },
    setFunctionBreakpoints: (request: DapRequest) => {
      const args = request.arguments as { breakpoints: Array<{ name: string }> };
      const breakpoints = (args?.breakpoints ?? []).map((bp, index) => ({
        id: 200 + index,
        verified: true,
      }));
      return { body: { breakpoints } };
    },
    disconnect: () => ({ body: {} }),
  } satisfies Record<string, (request: DapRequest) => ResponsePlan>;
}

describe('DapBackend', () => {
  it('maps stack, variables, and evaluate', async () => {
    const handlers = createDefaultHandlers();
    const spawner = createDapSpawner(handlers);
    const executor = createMockExecutor({ success: true, output: '/usr/bin/lldb-dap' });

    const backend = await createDapBackend({ executor, spawner, requestTimeoutMs: 1_000 });
    await backend.attach({ pid: 4242, simulatorId: 'sim-1' });

    const stack = await backend.getStack();
    expect(stack).toContain('frame #0: main at /tmp/main.swift:42');

    const vars = await backend.getVariables();
    expect(vars).toContain('Locals');
    expect(vars).toContain('answer (Int) = 42');

    const output = await backend.runCommand('frame variable');
    expect(output).toContain('evaluated');

    await backend.detach();
    await backend.dispose();
  });

  it('adds and removes breakpoints', async () => {
    const handlers = createDefaultHandlers();
    const spawner = createDapSpawner(handlers);
    const executor = createMockExecutor({ success: true, output: '/usr/bin/lldb-dap' });

    const backend = await createDapBackend({ executor, spawner, requestTimeoutMs: 1_000 });
    await backend.attach({ pid: 4242, simulatorId: 'sim-1' });

    const fileSpec: BreakpointSpec = { kind: 'file-line', file: '/tmp/main.swift', line: 12 };
    const fileBreakpoint = await backend.addBreakpoint(fileSpec, { condition: 'answer == 42' });
    expect(fileBreakpoint.id).toBe(100);

    await backend.removeBreakpoint(fileBreakpoint.id);

    const fnSpec: BreakpointSpec = { kind: 'function', name: 'doWork' };
    const fnBreakpoint = await backend.addBreakpoint(fnSpec);
    expect(fnBreakpoint.id).toBe(200);

    await backend.removeBreakpoint(fnBreakpoint.id);

    await backend.detach();
    await backend.dispose();
  });

  it('maps process interrupt to a DAP pause request', async () => {
    const handlers = createDefaultHandlers();
    const spawner = createDapSpawner(handlers);
    const executor = createMockExecutor({ success: true, output: '/usr/bin/lldb-dap' });

    const backend = await createDapBackend({ executor, spawner, requestTimeoutMs: 1_000 });
    await backend.attach({ pid: 4242, simulatorId: 'sim-1' });

    const output = await backend.runCommand('process interrupt');
    expect(output).toBe('Process interrupted.');

    const stack = await backend.getStack();
    expect(stack).toContain('frame #0: main at /tmp/main.swift:42');

    await backend.detach();
    await backend.dispose();
  });
});
