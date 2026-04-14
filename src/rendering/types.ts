import type { PipelineEvent } from '../types/pipeline-events.ts';
import type { NextStep, NextStepParamsMap } from '../types/common.ts';
import type { ToolDomainResult } from '../types/domain-results.ts';
import type { ProgressEvent } from '../types/progress-events.ts';

export type RenderStrategy = 'text' | 'cli-text';

export interface ImageAttachment {
  data: string;
  mimeType: string;
}

export interface RenderSession {
  emit(event: PipelineEvent): void;
  attach(image: ImageAttachment): void;
  getEvents(): readonly PipelineEvent[];
  getAttachments(): readonly ImageAttachment[];
  isError(): boolean;
  finalize(): string;
}

export interface StructuredToolOutput {
  result: ToolDomainResult;
  schema: string;
  schemaVersion: string;
}

export interface ToolHandlerContext {
  emit: (event: PipelineEvent) => void;
  attach: (image: ImageAttachment) => void;
  emitProgress?: (event: ProgressEvent) => void;
  nextStepParams?: NextStepParamsMap;
  nextSteps?: NextStep[];
  structuredOutput?: StructuredToolOutput;
}
