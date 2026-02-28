import { describe, expect, it } from 'vitest';
import { __mapLogLevelToSentryForTests, __shouldCaptureToSentryForTests } from '../logger.ts';

describe('logger sentry capture policy', () => {
  it('does not capture by default', () => {
    expect(__shouldCaptureToSentryForTests()).toBe(false);
  });

  it('does not capture when sentry is false', () => {
    expect(__shouldCaptureToSentryForTests({ sentry: false })).toBe(false);
  });

  it('captures only when explicitly enabled', () => {
    expect(__shouldCaptureToSentryForTests({ sentry: true })).toBe(true);
  });

  it('maps internal levels to Sentry log levels', () => {
    expect(__mapLogLevelToSentryForTests('emergency')).toBe('fatal');
    expect(__mapLogLevelToSentryForTests('warn')).toBe('warn');
    expect(__mapLogLevelToSentryForTests('notice')).toBe('info');
    expect(__mapLogLevelToSentryForTests('error')).toBe('error');
  });
});
