import { ChildProcess } from 'child_process';

// Runtime marker to prevent empty output in unbundled builds
export const _typeModule = true as const;

export interface CommandExecOptions {
  env?: Record<string, string>;
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
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
