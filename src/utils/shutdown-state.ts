import process from 'node:process';

type WritableMethod = (chunk: unknown, encoding?: unknown, callback?: unknown) => boolean;

interface StdioWriteTarget {
  write?: WritableMethod;
}

let stdioSuppressed = false;
let sentryCaptureSealed = false;
let originalStdoutWrite: WritableMethod | null = null;
let originalStderrWrite: WritableMethod | null = null;

function createSuppressedWrite(): WritableMethod {
  return (_chunk: unknown, encoding?: unknown, callback?: unknown): boolean => {
    const resolvedCallback =
      typeof encoding === 'function' ? encoding : typeof callback === 'function' ? callback : null;

    if (typeof resolvedCallback === 'function') {
      queueMicrotask(() => resolvedCallback(null));
    }

    return true;
  };
}

function setWrite(target: StdioWriteTarget | undefined, write: WritableMethod): void {
  if (!target || typeof target.write !== 'function') {
    return;
  }
  target.write = write;
}

export function suppressProcessStdioWrites(): void {
  if (stdioSuppressed) {
    return;
  }

  const stdout = process.stdout as StdioWriteTarget | undefined;
  const stderr = process.stderr as StdioWriteTarget | undefined;

  originalStdoutWrite = typeof stdout?.write === 'function' ? stdout.write.bind(stdout) : null;
  originalStderrWrite = typeof stderr?.write === 'function' ? stderr.write.bind(stderr) : null;

  const suppressedWrite = createSuppressedWrite();
  setWrite(stdout, suppressedWrite);
  setWrite(stderr, suppressedWrite);
  stdioSuppressed = true;
}

export function restoreProcessStdioWritesForTests(): void {
  const stdout = process.stdout as StdioWriteTarget | undefined;
  const stderr = process.stderr as StdioWriteTarget | undefined;

  if (originalStdoutWrite) {
    setWrite(stdout, originalStdoutWrite);
  }
  if (originalStderrWrite) {
    setWrite(stderr, originalStderrWrite);
  }

  originalStdoutWrite = null;
  originalStderrWrite = null;
  stdioSuppressed = false;
}

export function areProcessStdioWritesSuppressed(): boolean {
  return stdioSuppressed;
}

export function sealSentryCapture(): void {
  sentryCaptureSealed = true;
}

export function isSentryCaptureSealed(): boolean {
  return sentryCaptureSealed;
}

export function resetShutdownStateForTests(): void {
  restoreProcessStdioWritesForTests();
  sentryCaptureSealed = false;
}
