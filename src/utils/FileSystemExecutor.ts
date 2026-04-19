import type { WriteStream } from 'fs';

// Runtime marker to prevent empty output in unbundled builds
export const _typeModule = true as const;

export interface FileSystemExecutor {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string, encoding?: BufferEncoding): Promise<void>;
  createWriteStream(path: string, options?: { flags?: string }): WriteStream;
  cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<unknown[]>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  existsSync(path: string): boolean;
  stat(path: string): Promise<{ isDirectory(): boolean; mtimeMs: number }>;
  mkdtemp(prefix: string): Promise<string>;
  tmpdir(): string;
}
