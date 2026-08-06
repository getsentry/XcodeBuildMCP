import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireDaemonActivity,
  clearDaemonActivityRegistry,
} from '../../daemon/activity-registry.ts';
import {
  DEFAULT_MCP_IDLE_TIMEOUT_MS,
  MCP_IDLE_TIMEOUT_ENV_KEY,
  createMcpIdleShutdownController,
  resolveMcpIdleCheckIntervalMs,
  resolveMcpIdleTimeoutConfig,
  resolveMcpIdleTimeoutMs,
} from '../mcp-idle-shutdown.ts';

describe('MCP idle shutdown', () => {
  beforeEach(() => {
    clearDaemonActivityRegistry();
  });

  afterEach(() => {
    clearDaemonActivityRegistry();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('resolveMcpIdleTimeoutMs', () => {
    it('defaults to disabled when env is not set', () => {
      expect(resolveMcpIdleTimeoutMs({})).toBe(DEFAULT_MCP_IDLE_TIMEOUT_MS);
    });

    it('uses configured positive timeout', () => {
      expect(resolveMcpIdleTimeoutMs({ [MCP_IDLE_TIMEOUT_ENV_KEY]: '15000' })).toBe(15000);
    });

    it('uses configured zero timeout', () => {
      expect(resolveMcpIdleTimeoutMs({ [MCP_IDLE_TIMEOUT_ENV_KEY]: '0' })).toBe(0);
    });

    it('falls back to disabled for invalid timeout values', () => {
      expect(resolveMcpIdleTimeoutMs({ [MCP_IDLE_TIMEOUT_ENV_KEY]: '-1' })).toBe(0);
      expect(resolveMcpIdleTimeoutMs({ [MCP_IDLE_TIMEOUT_ENV_KEY]: 'NaN' })).toBe(0);
    });

    it('reports invalid raw values for startup logging', () => {
      expect(resolveMcpIdleTimeoutConfig({ [MCP_IDLE_TIMEOUT_ENV_KEY]: '-1' })).toEqual({
        timeoutMs: 0,
        rawValue: '-1',
        invalid: true,
      });
    });
  });

  describe('resolveMcpIdleCheckIntervalMs', () => {
    it('keeps the check interval within the minimum and default bounds', () => {
      expect(resolveMcpIdleCheckIntervalMs(1, 30_000)).toBe(100);
      expect(resolveMcpIdleCheckIntervalMs(250, 30_000)).toBe(250);
      expect(resolveMcpIdleCheckIntervalMs(60_000, 30_000)).toBe(30_000);
      expect(resolveMcpIdleCheckIntervalMs(0, 30_000)).toBe(30_000);
    });
  });

  it('does not start a timer when disabled', async () => {
    vi.useFakeTimers();
    const requestShutdown = vi.fn();
    const controller = createMcpIdleShutdownController({
      timeoutMs: 0,
      intervalMs: 10,
      requestShutdown,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it('restarts the idle window when activity is reported without in-flight work', async () => {
    vi.useFakeTimers();
    const requestShutdown = vi.fn();
    let now = 0;
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1_000,
      intervalMs: 100,
      nowMs: () => now,
      requestShutdown,
    });

    controller.start();

    // Just short of the deadline: still alive.
    now = 950;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).not.toHaveBeenCalled();

    // A subscription opens. It is not in-flight work, but it is activity.
    controller.markActivity();
    expect(controller.getInFlightRequestCount()).toBe(0);

    // Past the original deadline, but inside the restarted window.
    now = 1_500;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).not.toHaveBeenCalled();

    // The refreshed window is a delay, not a reprieve: idle shutdown still runs.
    now = 2_100;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('shuts down at the original deadline when no activity is reported', async () => {
    vi.useFakeTimers();
    const requestShutdown = vi.fn();
    let now = 0;
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1_000,
      intervalMs: 100,
      nowMs: () => now,
      requestShutdown,
    });

    controller.start();

    now = 950;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).not.toHaveBeenCalled();

    now = 1_050;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('does not let reported activity mask in-flight work', async () => {
    vi.useFakeTimers();
    const requestShutdown = vi.fn();
    let now = 0;
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1_000,
      intervalMs: 100,
      nowMs: () => now,
      requestShutdown,
    });

    controller.start();
    controller.markRequestStarted();
    controller.markActivity();

    now = 5_000;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).not.toHaveBeenCalled();

    controller.markRequestCompleted();
    now = 6_100;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('starts an unref interval when enabled', () => {
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(timer);
    const clearIntervalSpy = vi
      .spyOn(globalThis, 'clearInterval')
      .mockImplementation(() => undefined);
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1000,
      intervalMs: 50,
      requestShutdown: vi.fn(),
    });

    controller.start();
    controller.stop();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 50);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
  });

  it('requests shutdown after the configured idle period', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const requestShutdown = vi.fn();
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1000,
      intervalMs: 100,
      nowMs: () => nowMs,
      requestShutdown,
    });

    controller.start();
    nowMs = 1000;
    await vi.advanceTimersByTimeAsync(100);

    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('does not request shutdown while a request is in flight', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const requestShutdown = vi.fn();
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1000,
      intervalMs: 100,
      nowMs: () => nowMs,
      requestShutdown,
    });

    controller.start();
    controller.markRequestStarted();
    nowMs = 2000;
    await vi.advanceTimersByTimeAsync(100);

    expect(requestShutdown).not.toHaveBeenCalled();
    expect(controller.getInFlightRequestCount()).toBe(1);
  });

  it('does not request shutdown while daemon activity is active', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const requestShutdown = vi.fn();
    const release = acquireDaemonActivity('video.capture');
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1000,
      intervalMs: 100,
      nowMs: () => nowMs,
      requestShutdown,
    });

    controller.start();
    nowMs = 1000;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('does not request shutdown after the controller is stopped', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const requestShutdown = vi.fn();
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1000,
      intervalMs: 100,
      nowMs: () => nowMs,
      requestShutdown,
    });

    controller.start();
    controller.stop();
    nowMs = 1000;
    await vi.advanceTimersByTimeAsync(100);

    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it('resets the idle baseline when a request completes', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const requestShutdown = vi.fn();
    const controller = createMcpIdleShutdownController({
      timeoutMs: 1000,
      intervalMs: 100,
      nowMs: () => nowMs,
      requestShutdown,
    });

    controller.start();
    controller.markRequestStarted();
    nowMs = 800;
    controller.markRequestCompleted();
    expect(controller.getInFlightRequestCount()).toBe(0);

    nowMs = 1700;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).not.toHaveBeenCalled();

    nowMs = 1800;
    await vi.advanceTimersByTimeAsync(100);
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });
});
