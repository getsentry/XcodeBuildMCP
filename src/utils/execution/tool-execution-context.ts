import type { ToolDomainResult } from '../../types/domain-results.js';
import type { ProgressEvent, XcodebuildOperation } from '../../types/progress-events.js';
import type { ToolAttachment, ToolExecutionContext } from '../../types/tool-execution.js';

export interface DefaultToolExecutionContextOptions {
  xcodebuildOperation?: XcodebuildOperation;
  progressSink?: (event: ProgressEvent) => void;
}

export class DefaultToolExecutionContext implements ToolExecutionContext {
  private readonly progressEvents: ProgressEvent[] = [];
  private readonly attachments: ToolAttachment[] = [];
  private readonly progressSink?: (event: ProgressEvent) => void;
  private result?: ToolDomainResult;

  constructor(options: DefaultToolExecutionContextOptions = {}) {
    this.progressSink = options.progressSink;
  }

  emitProgress(event: ProgressEvent): void {
    this.progressEvents.push(event);
    this.progressSink?.(event);
  }

  attach(image: ToolAttachment): void {
    this.attachments.push(image);
  }

  emitResult(result: ToolDomainResult): void {
    this.result = result;
  }

  getProgressEvents(): readonly ProgressEvent[] {
    return [...this.progressEvents];
  }

  getAttachments(): readonly ToolAttachment[] {
    return [...this.attachments];
  }

  getResult(): ToolDomainResult | undefined {
    return this.result;
  }
}
