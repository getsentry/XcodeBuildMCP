import { performance } from 'node:perf_hooks';

export interface ProgressReporter {
  readonly enabled: boolean;
  setSuite(index: number, total: number, name: string): void;
  event(message: string): void;
}

export interface ProgressReporterOptions {
  enabled: boolean;
  write?: (line: string) => void;
  now?: () => number;
}

interface SuiteContext {
  index: number;
  total: number;
  name: string;
  startedAt: number;
}

function defaultWrite(line: string): void {
  process.stderr.write(`${line}\n`);
}

function defaultNow(): number {
  return performance.now();
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function createProgressReporter(opts: ProgressReporterOptions): ProgressReporter {
  const write = opts.write ?? defaultWrite;
  const now = opts.now ?? defaultNow;
  let context: SuiteContext | undefined;

  return {
    enabled: opts.enabled,
    setSuite(index: number, total: number, name: string): void {
      context = { index, total, name, startedAt: now() };
    },
    event(message: string): void {
      if (!opts.enabled) return;
      if (!context) {
        write(message);
        return;
      }
      const elapsed = formatElapsed(now() - context.startedAt);
      write(`[${context.index}/${context.total} ${context.name}] ${elapsed}  ${message}`);
    },
  };
}
