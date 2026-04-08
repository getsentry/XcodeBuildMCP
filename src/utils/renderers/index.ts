import path from 'node:path';
import type { HeaderEvent, PipelineEvent } from '../../types/pipeline-events.ts';

export interface PipelineRenderer {
  onEvent(event: PipelineEvent): void;
  finalize(): void;
}

export function deriveDiagnosticBaseDir(event: HeaderEvent): string | null {
  for (const param of event.params) {
    if (param.label === 'Workspace' || param.label === 'Project') {
      return path.dirname(path.resolve(process.cwd(), param.value));
    }
  }
  return null;
}

export { createCliTextRenderer } from './cli-text-renderer.ts';
