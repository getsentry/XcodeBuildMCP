import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspaceFilesystemLayout } from './log-paths.ts';
import { getRuntimeInstance } from './runtime-instance.ts';
import { scheduleArtifactCreatedSweep } from './workspace-filesystem-lifecycle.ts';
import { formatLogTimestamp, shortRandomSuffix } from './log-naming.ts';

let logDirOverrideForTests: string | null = null;

interface ResolvedLogDir {
  path: string;
  isOverride: boolean;
}

function resolveWritableLogDir(): ResolvedLogDir {
  const logDir =
    logDirOverrideForTests ?? getWorkspaceFilesystemLayout(getRuntimeInstance().workspaceKey).logs;

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.accessSync(logDir, fs.constants.W_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to create writable log directory at ${logDir}: ${message}`);
  }

  return {
    path: logDir,
    isOverride: logDirOverrideForTests !== null,
  };
}

function generateLogFileName(toolName: string): string {
  return `${toolName}_${formatLogTimestamp()}_pid${process.pid}_${shortRandomSuffix()}.log`;
}

export interface LogCapture {
  write(chunk: string): void;
  readonly path: string;
  close(): void;
}

export function createLogCapture(toolName: string): LogCapture {
  const logDir = resolveWritableLogDir();
  scheduleArtifactCreatedSweep(logDir);
  const logPath = path.join(logDir.path, generateLogFileName(toolName));
  let fd: number | null = null;

  function ensureOpen(): number {
    if (fd !== null) {
      return fd;
    }
    fd = fs.openSync(logPath, 'wx');
    return fd;
  }

  return {
    write(chunk: string): void {
      if (chunk.length === 0) {
        return;
      }
      fs.writeSync(ensureOpen(), chunk);
    },
    get path(): string {
      return logPath;
    },
    close(): void {
      if (fd === null) {
        return;
      }
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      } finally {
        fd = null;
      }
    },
  };
}

export interface ParserDebugCapture {
  addUnrecognizedLine(line: string): void;
  readonly count: number;
  flush(): string | null;
}

export function setXcodebuildLogDirOverrideForTests(dir: string | null): void {
  logDirOverrideForTests = dir;
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
      scheduleArtifactCreatedSweep(logDir);
      const debugPath = path.join(logDir.path, generateLogFileName(`${toolName}_parser-debug`));
      fs.writeFileSync(
        debugPath,
        `Unrecognized xcodebuild output lines (${lines.length}):\n\n${lines.join('\n')}\n`,
        { flag: 'wx' },
      );
      return debugPath;
    },
  };
}
