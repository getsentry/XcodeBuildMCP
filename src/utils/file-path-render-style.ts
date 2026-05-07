import type { FilePathRenderStyle } from './runtime-config-types.ts';

export type FilePathRenderRuntime = 'cli' | 'daemon' | 'mcp';

export function isFilePathRenderStyle(value: unknown): value is FilePathRenderStyle {
  return value === 'tree' || value === 'list';
}

export function defaultFilePathRenderStyleForRuntime(
  runtime: FilePathRenderRuntime,
): FilePathRenderStyle {
  return runtime === 'mcp' ? 'tree' : 'list';
}

export function resolveFilePathRenderStyle(options: {
  explicit?: FilePathRenderStyle;
  configured?: FilePathRenderStyle;
  runtime: FilePathRenderRuntime;
}): FilePathRenderStyle {
  return (
    options.explicit ?? options.configured ?? defaultFilePathRenderStyleForRuntime(options.runtime)
  );
}

export function normalizeRenderRuntime(runtime: string | undefined): FilePathRenderRuntime {
  return runtime === 'mcp' || runtime === 'daemon' ? runtime : 'cli';
}
