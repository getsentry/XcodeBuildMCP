import { ChildProcess } from 'child_process';

// Runtime marker to prevent empty output in unbundled builds
export const _typeModule = true as const;

export interface CommandExecOptions {
  env?: Record<string, string>;
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /**
   * Maximum number of bytes to accumulate per stream (stdout/stderr) before
   * truncating. Prevents `RangeError: Invalid string length` when very large
   * outputs (e.g. verbose xcodebuild logs) exceed V8's maximum string length
   * (~512MB on 64-bit). Defaults to XCODEBUILDMCP_MAX_OUTPUT_BYTES env var or
   * 64 MiB.
   */
  maxOutputBytes?: number;
}

/**
 * NOTE: `detached` only changes when the promise resolves; it does not detach/unref
 * the OS process. Callers must still manage lifecycle and open streams.
 */
export type CommandExecutor = (
  command: string[],
  logPrefix?: string,
  useShell?: boolean,
  opts?: CommandExecOptions,
  detached?: boolean,
) => Promise<CommandResponse>;

export interface CommandResponse {
  success: boolean;
  output: string;
  error?: string;
  process: ChildProcess;
  exitCode?: number;
}
