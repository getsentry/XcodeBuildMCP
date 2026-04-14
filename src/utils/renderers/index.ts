import path from 'node:path';
import type { NextStep } from '../../types/common.ts';
import type { StructuredToolOutput } from '../../rendering/types.ts';
import type { HeaderProgressEvent, ProgressEvent } from '../../types/progress-events.ts';

export interface TranscriptRenderer {
  onProgress(event: ProgressEvent): void;
  setStructuredOutput(output: StructuredToolOutput): void;
  setNextSteps(steps: readonly NextStep[], runtime: 'cli' | 'daemon' | 'mcp'): void;
  finalize(): void;
}

export type PipelineRenderer = TranscriptRenderer;

export function deriveDiagnosticBaseDir(event: HeaderProgressEvent): string | null {
  for (const param of event.params) {
    if (param.label === 'Workspace' || param.label === 'Project') {
      return path.dirname(path.resolve(process.cwd(), param.value));
    }
  }
  return null;
}

export { createCliTextRenderer } from './cli-text-renderer.ts';
