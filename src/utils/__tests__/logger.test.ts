import { afterEach, describe, expect, it } from 'vitest';
import { __mapLogLevelToSentryForTests, __shouldCaptureToSentryForTests } from '../logger.ts';
import { resetShutdownStateForTests, sealSentryCapture } from '../shutdown-state.ts';

describe('logger third-party capture policy', () => {
  afterEach(() => {
    resetShutdownStateForTests();
  });
  it('does not capture by default', () => {
    expect(__shouldCaptureToSentryForTests()).toBe(false);
  });

  it('does not capture when sentry is false', () => {
    expect(__shouldCaptureToSentryForTests({ sentry: false })).toBe(false);
  });

  it('does not capture even when sentry is explicitly enabled', () => {
    expect(__shouldCaptureToSentryForTests({ sentry: true })).toBe(false);
  });

  it('does not capture after sentry sealing', () => {
    sealSentryCapture();
    expect(__shouldCaptureToSentryForTests({ sentry: true })).toBe(false);
  });

  it('does not map internal levels to third-party log levels', () => {
    expect(__mapLogLevelToSentryForTests('emergency')).toBe('emergency');
    expect(__mapLogLevelToSentryForTests('warn')).toBe('warn');
    expect(__mapLogLevelToSentryForTests('notice')).toBe('notice');
    expect(__mapLogLevelToSentryForTests('error')).toBe('error');
  });
});
