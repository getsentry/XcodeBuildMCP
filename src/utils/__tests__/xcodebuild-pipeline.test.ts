import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createXcodebuildPipeline } from '../xcodebuild-pipeline.ts';
import { STAGE_RANK } from '../../types/pipeline-events.ts';
import type { PipelineEvent } from '../../types/pipeline-events.ts';
import { renderEvents } from '../../rendering/render.ts';

describe('xcodebuild-pipeline', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.XCODEBUILDMCP_RUNTIME = 'mcp';
    delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('produces MCP content from xcodebuild test output', () => {
    const emittedEvents: PipelineEvent[] = [];
    const pipeline = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: { scheme: 'MyApp' },
      emit: (event) => emittedEvents.push(event),
    });

    pipeline.emitEvent({
      type: 'header',
      timestamp: '2025-01-01T00:00:00.000Z',
      operation: 'Test',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    pipeline.onStdout('Resolve Package Graph\n');
    pipeline.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    pipeline.onStdout("Test Case '-[Suite testA]' passed (0.001 seconds)\n");
    pipeline.onStdout("Test Case '-[Suite testB]' failed (0.002 seconds)\n");

    const result = pipeline.finalize(false, 2345);

    expect(result.state.finalStatus).toBe('FAILED');
    expect(result.state.completedTests).toBe(2);
    expect(result.state.failedTests).toBe(1);
    expect(result.state.milestones.map((m) => m.stage)).toContain('RESOLVING_PACKAGES');
    expect(result.state.milestones.map((m) => m.stage)).toContain('COMPILING');

    // Rendered text should contain relevant content
    const text = renderEvents(emittedEvents, 'text');
    expect(text).toContain('Test');
    expect(text).toContain('Resolving packages');

    // Events array should contain all events
    expect(emittedEvents.length).toBeGreaterThan(0);
    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain('header');
    expect(eventTypes).toContain('build-stage');
    expect(eventTypes).toContain('test-progress');
    expect(eventTypes).toContain('summary');
  });

  it('handles build output with warnings and errors', () => {
    const emittedEvents: PipelineEvent[] = [];
    const pipeline = createXcodebuildPipeline({
      operation: 'BUILD',
      toolName: 'build_sim',
      params: { scheme: 'MyApp' },
      emit: (event) => emittedEvents.push(event),
    });

    pipeline.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    pipeline.onStdout('/tmp/App.swift:10:5: warning: variable unused\n');
    pipeline.onStdout("/tmp/App.swift:20:3: error: type 'Foo' has no member 'bar'\n");

    const result = pipeline.finalize(false, 500);

    expect(result.state.warnings).toHaveLength(1);
    expect(result.state.errors).toHaveLength(1);
    expect(result.state.finalStatus).toBe('FAILED');
  });

  it('supports multi-phase with minimumStage', () => {
    // Phase 1: build-for-testing
    const phase1Events: PipelineEvent[] = [];
    const phase1 = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
      emit: (event) => phase1Events.push(event),
    });

    phase1.onStdout('Resolve Package Graph\n');
    phase1.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');

    const phase1Rank = phase1.highestStageRank();
    expect(phase1Rank).toBe(STAGE_RANK.COMPILING);

    phase1.finalize(true, 1000);

    // Phase 2: test-without-building, skipping stages already seen
    const stageEntries = Object.entries(STAGE_RANK) as Array<[string, number]>;
    const minStage = stageEntries.find(([, rank]) => rank === phase1Rank)?.[0] as
      | 'COMPILING'
      | undefined;

    const phase2Events: PipelineEvent[] = [];
    const phase2 = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
      minimumStage: minStage,
      emit: (event) => phase2Events.push(event),
    });

    // These should be suppressed
    phase2.onStdout('Resolve Package Graph\n');
    phase2.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    // This should pass through
    phase2.onStdout("Test Case '-[Suite testA]' passed (0.001 seconds)\n");

    const result = phase2.finalize(true, 2000);

    // Only RUN_TESTS milestone (auto-inserted from test-progress), not RESOLVING_PACKAGES or COMPILING
    const milestoneStages = result.state.milestones.map((m) => m.stage);
    expect(milestoneStages).not.toContain('RESOLVING_PACKAGES');
    expect(milestoneStages).not.toContain('COMPILING');
    expect(milestoneStages).toContain('RUN_TESTS');
    expect(result.state.completedTests).toBe(1);
  });

  it('emitEvent passes tool-originated events through the pipeline', () => {
    const emittedEvents: PipelineEvent[] = [];
    const pipeline = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
      emit: (event) => emittedEvents.push(event),
    });

    pipeline.emitEvent({
      type: 'test-discovery',
      timestamp: '2025-01-01T00:00:00.000Z',
      operation: 'TEST',
      total: 3,
      tests: ['testA', 'testB', 'testC'],
      truncated: false,
    });

    pipeline.finalize(true, 100);

    const discoveryEvents = emittedEvents.filter((e) => e.type === 'test-discovery');
    expect(discoveryEvents).toHaveLength(1);

    const text = renderEvents(emittedEvents, 'text');
    expect(text).toContain(
      'Discovered 3 test(s):\n   testA\n   testB\n   testC\n\n✅ Test succeeded.',
    );
  });

  it('renders test discovery in cli-text mode', () => {
    const emittedEvents: PipelineEvent[] = [
      {
        type: 'test-discovery',
        timestamp: '2025-01-01T00:00:00.000Z',
        operation: 'TEST',
        total: 8,
        tests: ['testA', 'testB', 'testC', 'testD', 'testE', 'testF', 'testG', 'testH'],
        truncated: false,
      },
      {
        type: 'summary',
        timestamp: '2025-01-01T00:00:01.000Z',
        operation: 'TEST',
        status: 'SUCCEEDED',
        totalTests: 8,
        passedTests: 8,
        failedTests: 0,
        skippedTests: 0,
        durationMs: 100,
      },
    ];

    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    try {
      renderEvents(emittedEvents, 'cli-text');
    } finally {
      writeSpy.mockRestore();
    }

    const output = writes.join('');
    expect(output).toContain('Discovered 8 test(s):');
    expect(output).toContain('   testA\n');
    expect(output).toContain('   testF\n');
    expect(output).not.toContain('   testG\n');
    expect(output).toContain('   (...and 2 more)');
  });

  it('produces JSONL output in CLI json mode', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'json';

    const emittedEvents: PipelineEvent[] = [];
    const pipeline = createXcodebuildPipeline({
      operation: 'BUILD',
      toolName: 'build_sim',
      params: {},
      emit: (event) => emittedEvents.push(event),
    });

    pipeline.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    pipeline.finalize(true, 100);

    expect(emittedEvents.length).toBeGreaterThan(0);

    // Each emitted event should be valid JSON-serializable with required fields
    for (const event of emittedEvents) {
      const parsed = JSON.parse(JSON.stringify(event));
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('timestamp');
    }
  });
});
