import type { NextStep, NextStepParamsMap } from '../types/common.ts';
import type { ToolDomainResult } from '../types/domain-results.ts';
import type { ProgressEvent } from '../types/progress-events.ts';

export type RenderStrategy = 'text' | 'cli-text';

export interface ImageAttachment {
  data: string;
  mimeType: string;
}

export interface RenderSession {
  emit(event: ProgressEvent): void;
  attach(image: ImageAttachment): void;
  setStructuredOutput?(output: StructuredToolOutput): void;
  getStructuredOutput?(): StructuredToolOutput | undefined;
  setNextSteps?(steps: NextStep[], runtime: 'cli' | 'daemon' | 'mcp'): void;
  getNextSteps?(): readonly NextStep[];
  getNextStepsRuntime?(): 'cli' | 'daemon' | 'mcp' | undefined;
  getEvents(): readonly ProgressEvent[];
  getProgressEvents?(): readonly ProgressEvent[];
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
  emit: (event: ProgressEvent) => void;
  attach: (image: ImageAttachment) => void;
  emitProgress: (event: ProgressEvent) => void;
  liveProgressEnabled: boolean;
  nextStepParams?: NextStepParamsMap;
  nextSteps?: NextStep[];
  structuredOutput?: StructuredToolOutput;
}
