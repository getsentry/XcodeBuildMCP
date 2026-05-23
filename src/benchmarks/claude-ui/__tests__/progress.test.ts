import { createProgressReporter, formatElapsed } from '../progress.ts';

describe('formatElapsed', () => {
  it('formats sub-minute durations as mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(1500)).toBe('00:01');
    expect(formatElapsed(59_999)).toBe('00:59');
  });

  it('formats multi-minute durations as mm:ss', () => {
    expect(formatElapsed(60_000)).toBe('01:00');
    expect(formatElapsed(125_000)).toBe('02:05');
  });

  it('clamps negative inputs to zero', () => {
    expect(formatElapsed(-1000)).toBe('00:00');
  });
});

describe('createProgressReporter', () => {
  it('emits nothing when disabled', () => {
    const lines: string[] = [];
    const reporter = createProgressReporter({
      enabled: false,
      write: (line) => lines.push(line),
      now: () => 0,
    });

    reporter.setSuite(1, 2, 'weather');
    reporter.event('artifacts: out.nosync/foo');
    reporter.event('launching claude');

    expect(reporter.enabled).toBe(false);
    expect(lines).toEqual([]);
  });

  it('prefixes events with suite context and elapsed time', () => {
    const lines: string[] = [];
    let nowMs = 1_000;
    const reporter = createProgressReporter({
      enabled: true,
      write: (line) => lines.push(line),
      now: () => nowMs,
    });

    reporter.setSuite(1, 3, 'contacts');
    reporter.event('artifacts: out.nosync/foo');
    nowMs += 2_500;
    reporter.event('creating temporary simulator (iPhone 17 Pro Max)');
    nowMs += 60_000;
    reporter.event('claude finished in 60.00s (exit 0)');

    expect(lines).toEqual([
      '[1/3 contacts] 00:00  artifacts: out.nosync/foo',
      '[1/3 contacts] 00:02  creating temporary simulator (iPhone 17 Pro Max)',
      '[1/3 contacts] 01:02  claude finished in 60.00s (exit 0)',
    ]);
  });

  it('resets elapsed time when a new suite begins', () => {
    const lines: string[] = [];
    let nowMs = 0;
    const reporter = createProgressReporter({
      enabled: true,
      write: (line) => lines.push(line),
      now: () => nowMs,
    });

    reporter.setSuite(1, 2, 'contacts');
    nowMs = 5_000;
    reporter.event('parsing transcript');
    nowMs = 7_000;
    reporter.setSuite(2, 2, 'weather');
    nowMs = 9_000;
    reporter.event('artifacts: out.nosync/weather');

    expect(lines).toEqual([
      '[1/2 contacts] 00:05  parsing transcript',
      '[2/2 weather] 00:02  artifacts: out.nosync/weather',
    ]);
  });

  it('falls back to bare messages when no suite context has been set', () => {
    const lines: string[] = [];
    const reporter = createProgressReporter({
      enabled: true,
      write: (line) => lines.push(line),
      now: () => 0,
    });

    reporter.event('orphan event');

    expect(lines).toEqual(['orphan event']);
  });
});
