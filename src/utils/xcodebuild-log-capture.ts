import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LOG_DIR } from './log-paths.ts';

const FALLBACK_LOG_DIR = path.join(os.tmpdir(), 'XcodeBuildMCP', 'logs');

function resolveWritableLogDir(): string {
  const candidates = [LOG_DIR, FALLBACK_LOG_DIR];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `Unable to create writable log directory in any candidate path: ${candidates.join(', ')}`,
  );
}

function generateLogFileName(toolName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${toolName}_${timestamp}_pid${process.pid}.log`;
}

export interface LogCapture {
  write(chunk: string): void;
  readonly path: string;
  close(): void;
}

export function createLogCapture(toolName: string): LogCapture {
  const logDir = resolveWritableLogDir();
  const logPath = path.join(logDir, generateLogFileName(toolName));
  const fd = fs.openSync(logPath, 'w');

  return {
    write(chunk: string): void {
      fs.writeSync(fd, chunk);
    },
    get path(): string {
      return logPath;
    },
    close(): void {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    },
  };
}

export interface ParserDebugCapture {
  addUnrecognizedLine(line: string): void;
  readonly count: number;
  flush(): string | null;
}

export function createParserDebugCapture(toolName: string): ParserDebugCapture {
  const lines: string[] = [];

  return {
    addUnrecognizedLine(line: string): void {
      lines.push(line);
    },
    get count(): number {
      return lines.length;
    },
    flush(): string | null {
      if (lines.length === 0) return null;
      const logDir = resolveWritableLogDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugPath = path.join(logDir, `${toolName}_parser-debug_${timestamp}.log`);
      fs.writeFileSync(
        debugPath,
        `Unrecognized xcodebuild output lines (${lines.length}):\n\n${lines.join('\n')}\n`,
      );
      return debugPath;
    },
  };
}
