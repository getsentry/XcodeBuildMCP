import type { PipelineEvent } from '../types/pipeline-events.ts';
import type { NextStep, NextStepParamsMap } from '../types/common.ts';

export type RenderStrategy = 'text' | 'cli-text' | 'cli-json';

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

export interface ToolHandlerContext {
  emit: (event: PipelineEvent) => void;
  attach: (image: ImageAttachment) => void;
  nextStepParams?: NextStepParamsMap;
  nextSteps?: NextStep[];
}
