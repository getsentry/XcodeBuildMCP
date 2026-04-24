import type { NextStep, NextStepParamsMap } from '../types/common.ts';
import type { AnyFragment } from '../types/domain-fragments.ts';
import type { ToolDomainResult } from '../types/domain-results.ts';

export type RenderStrategy = 'text' | 'cli-text' | 'raw';

export interface ImageAttachment {
  data: string;
  mimeType: string;
}

export interface RenderSession {
  emit(fragment: AnyFragment): void;
  attach(image: ImageAttachment): void;
  setStructuredOutput?(output: StructuredToolOutput): void;
  getStructuredOutput?(): StructuredToolOutput | undefined;
  setNextSteps?(steps: NextStep[], runtime: 'cli' | 'daemon' | 'mcp'): void;
  getNextSteps?(): readonly NextStep[];
  getNextStepsRuntime?(): 'cli' | 'daemon' | 'mcp' | undefined;
  getFragments(): readonly AnyFragment[];
  getAttachments(): readonly ImageAttachment[];
  isError(): boolean;
  finalize(): string;
}

export interface RenderHints {
  headerTitle?: string;
}

export interface StructuredToolOutput {
  result: ToolDomainResult;
  schema: string;
  schemaVersion: string;
  renderHints?: RenderHints;
}

export interface ToolHandlerContext {
  emit: (fragment: AnyFragment) => void;
  attach: (image: ImageAttachment) => void;
  liveProgressEnabled: boolean;
  streamingFragmentsEnabled: boolean;
  nextStepParams?: NextStepParamsMap;
  nextSteps?: NextStep[];
  structuredOutput?: StructuredToolOutput;
}
