import { beforeEach, describe, expect, it } from 'vitest';
import { createMockToolHandlerContext } from '../../test-utils/test-helpers.ts';
import { startBuildPipeline } from '../xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../xcodebuild-output.ts';

async function runFinalizedPipeline(
  logic: (
    started: ReturnType<typeof startBuildPipeline>,
    emit: (
      event: Parameters<ReturnType<typeof createMockToolHandlerContext>['ctx']['emit']>[0],
    ) => void,
  ) => void,
): Promise<ReturnType<typeof createMockToolHandlerContext>['result']> {
  const { ctx, result, run } = createMockToolHandlerContext();
  await run(async () => {
    const started = startBuildPipeline({
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: { scheme: 'MyApp' },
      message: '🚀 Build & Run\n\n  Scheme: MyApp',
    });

    logic(started, ctx.emit);
  });
  return result;
}

describe('xcodebuild-output', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, XCODEBUILDMCP_RUNTIME: 'mcp' };
    delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
  });

  it('suppresses fallback error content when structured diagnostics already exist', async () => {
    const result = await runFinalizedPipeline((started, emit) => {
      started.pipeline.emitEvent({
        type: 'compiler-error',
        timestamp: '2026-03-20T12:00:00.500Z',
        operation: 'BUILD',
        message: 'unterminated string literal',
        rawLine: '/tmp/MyApp.swift:10:1: error: unterminated string literal',
      });

      finalizeInlineXcodebuild({
        started,
        emit,
        succeeded: false,
        durationMs: 100,
        responseContent: [{ type: 'text', text: 'Legacy fallback error block' }],
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      });
    });

    const textContent = result.text();
    expect(textContent).toContain('Compiler Errors (1):');
    expect(textContent).toContain('  ✗ unterminated string literal');
    expect(textContent).toContain('    /tmp/MyApp.swift:10:1');
    expect(textContent).not.toContain('Legacy fallback error block');
  });

  it('preserves fallback error content when no structured diagnostics exist', async () => {
    const result = await runFinalizedPipeline((started, emit) => {
      finalizeInlineXcodebuild({
        started,
        emit,
        succeeded: false,
        durationMs: 100,
        responseContent: [{ type: 'text', text: 'Legacy fallback error block' }],
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      });
    });

    expect(result.text()).toContain('Legacy fallback error block');
  });

  it('renders build logs in a metadata tree after the summary when no tail detail tree exists', async () => {
    const result = await runFinalizedPipeline((started, emit) => {
      finalizeInlineXcodebuild({
        started,
        emit,
        succeeded: true,
        durationMs: 100,
      });
    });

    expect(result.events.at(-2)?.type).toBe('summary');
    expect(result.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'detail-tree',
        items: [
          expect.objectContaining({
            label: 'Build Logs',
            value: expect.stringContaining('build_run_macos_'),
          }),
        ],
      }),
    );
    expect(result.text()).toContain('✅ Build succeeded.');
    expect(result.text()).toContain('└ Build Logs:');
  });

  it('surfaces parser debug logs with a warning notice before summary', async () => {
    const result = await runFinalizedPipeline((started, emit) => {
      started.pipeline.onStdout('UNRECOGNIZED LINE\n');

      finalizeInlineXcodebuild({
        started,
        emit,
        succeeded: true,
        durationMs: 100,
        includeParserDebugFileRef: true,
      });
    });

    const textContent = result.text();
    expect(textContent).toContain('⚠️ Parsing issue detected - debug log:');
    expect(textContent).toContain('Parser Debug Log:');
  });

  it('finalizes summary before execution-derived footer events', async () => {
    const result = await runFinalizedPipeline((started, emit) => {
      finalizeInlineXcodebuild({
        started,
        emit,
        succeeded: true,
        durationMs: 100,
        tailEvents: [
          {
            type: 'status-line',
            timestamp: '2026-03-20T12:00:01.000Z',
            level: 'success',
            message: 'Build & Run complete',
          },
          {
            type: 'detail-tree',
            timestamp: '2026-03-20T12:00:01.000Z',
            items: [{ label: 'App Path', value: '/tmp/build/MyApp.app' }],
          },
        ],
      });
    });

    const lastThreeTypes = result.events.slice(-3).map((event) => event.type);
    expect(lastThreeTypes).toEqual(['summary', 'status-line', 'detail-tree']);
    expect(result.text()).toContain('✅ Build & Run complete');
  });
});
