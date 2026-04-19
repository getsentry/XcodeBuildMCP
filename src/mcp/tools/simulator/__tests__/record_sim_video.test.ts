import { describe, it, expect, vi, afterEach } from 'vitest';

import { schema, handler, record_sim_videoLogic } from '../record_sim_video.ts';
import { createMockFileSystemExecutor } from '../../../../test-utils/mock-executors.ts';
import { createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';

const DUMMY_EXECUTOR: any = (async () => ({ success: true })) as any; // CommandExecutor stub
const VALID_SIM_ID = '00000000-0000-0000-0000-000000000000';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('record_sim_video tool - validation', () => {
  it('errors when start and stop are both true (mutually exclusive)', async () => {
    const res = await handler({
      simulatorId: VALID_SIM_ID,
      start: true,
      stop: true,
    } as any);

    expect(res.isError).toBe(true);
    const text = (res.content?.[0] as any)?.text ?? '';
    expect(text.toLowerCase()).toContain('mutually exclusive');
  });

  it('errors when stop=true but outputFile is missing', async () => {
    const res = await handler({
      simulatorId: VALID_SIM_ID,
      stop: true,
    } as any);

    expect(res.isError).toBe(true);
    const text = (res.content?.[0] as any)?.text ?? '';
    expect(text.toLowerCase()).toContain('outputfile is required');
  });
});

describe('record_sim_video logic - start behavior', () => {
  it('starts with default fps (30) and warns when outputFile is provided on start (ignored)', async () => {
    const video: any = {
      startSimulatorVideoCapture: async () => ({
        started: true,
        sessionId: 'sess-123',
      }),
      stopSimulatorVideoCapture: async () => ({
        stopped: false,
      }),
    };

    const axe = {
      areAxeToolsAvailable: () => true,
      isAxeAtLeastVersion: async () => true,
    };

    const fs = createMockFileSystemExecutor();

    const { result, run } = createMockToolHandlerContext();
    await run(() =>
      record_sim_videoLogic(
        {
          simulatorId: VALID_SIM_ID,
          start: true,
          outputFile: '/tmp/ignored.mp4',
        } as any,
        DUMMY_EXECUTOR,
        axe,
        video,
        fs,
      ),
    );

    expect(result.isError()).toBe(false);
    const texts = result.text();

    expect(texts).toContain('30');
    expect(texts.toLowerCase()).toContain('outputfile is ignored');

    expect(result.nextStepParams).toBeDefined();
    expect(result.nextStepParams?.record_sim_video).toBeDefined();
    expect(result.nextStepParams?.record_sim_video).toHaveProperty('stop', true);
    expect(result.nextStepParams?.record_sim_video).toHaveProperty('outputFile');
  });
});

describe('record_sim_video logic - end-to-end stop with rename', () => {
  it('stops, parses stdout path, and renames to outputFile', async () => {
    const video: any = {
      startSimulatorVideoCapture: async () => ({
        started: true,
        sessionId: 'sess-abc',
      }),
      stopSimulatorVideoCapture: async () => ({
        stopped: true,
        parsedPath: '/tmp/recorded.mp4',
        stdout: 'Saved to /tmp/recorded.mp4',
      }),
    };

    const fs = createMockFileSystemExecutor();

    const axe = {
      areAxeToolsAvailable: () => true,
      isAxeAtLeastVersion: async () => true,
    };

    const { result: startResult, run: runStart } = createMockToolHandlerContext();
    await runStart(() =>
      record_sim_videoLogic(
        {
          simulatorId: VALID_SIM_ID,
          start: true,
        } as any,
        DUMMY_EXECUTOR,
        axe,
        video,
        fs,
      ),
    );
    expect(startResult.isError()).toBe(false);

    const outputFile = '/var/videos/final.mp4';
    const { result: stopResult, run: runStop } = createMockToolHandlerContext();
    await runStop(() =>
      record_sim_videoLogic(
        {
          simulatorId: VALID_SIM_ID,
          stop: true,
          outputFile,
        } as any,
        DUMMY_EXECUTOR,
        axe,
        video,
        fs,
      ),
    );

    expect(stopResult.isError()).toBe(false);
    const texts = stopResult.text();
    expect(texts).toContain('Original file: /tmp/recorded.mp4');
    expect(texts).toContain(`Saved to: ${outputFile}`);
  });
});

describe('record_sim_video logic - version gate', () => {
  it('errors when AXe version is below 1.1.0', async () => {
    const axe = {
      areAxeToolsAvailable: () => true,
      isAxeAtLeastVersion: async () => false,
    };

    const video: any = {
      startSimulatorVideoCapture: async () => ({
        started: true,
        sessionId: 'sess-xyz',
      }),
      stopSimulatorVideoCapture: async () => ({
        stopped: true,
      }),
    };

    const fs = createMockFileSystemExecutor();

    const { result, run } = createMockToolHandlerContext();
    await run(() =>
      record_sim_videoLogic(
        {
          simulatorId: VALID_SIM_ID,
          start: true,
        } as any,
        DUMMY_EXECUTOR,
        axe,
        video,
        fs,
      ),
    );

    expect(result.isError()).toBe(true);
    const text = result.text();
    expect(text).toContain('AXe v1.1.0');
  });
});
