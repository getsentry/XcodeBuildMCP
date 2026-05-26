import type { OutputStyle } from '../types/common.ts';
import type { FilePathRenderStyle } from './runtime-config-types.ts';

export function isFilePathRenderStyle(value: unknown): value is FilePathRenderStyle {
  return value === 'tree' || value === 'list';
}

export function resolveFilePathRenderStyle(options: {
  explicit?: FilePathRenderStyle;
  configured?: FilePathRenderStyle;
  outputStyle?: OutputStyle;
}): FilePathRenderStyle {
  return (
    options.explicit ?? options.configured ?? (options.outputStyle === 'minimal' ? 'tree' : 'list')
  );
}
