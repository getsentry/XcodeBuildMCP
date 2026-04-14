import type { RenderSession } from '../../rendering/types.js';
import type { ToolDomainResult } from '../../types/domain-results.js';
import type { PipelineEvent, XcodebuildOperation } from '../../types/pipeline-events.js';
import type { ProgressEvent } from '../../types/progress-events.js';
import type { ToolAttachment, ToolExecutionContext } from '../../types/tool-execution.js';
import { DomainResultPipelineEventAdapter } from '../domain-result-adapter.js';

export interface DefaultToolExecutionContextOptions {
  renderSession?: RenderSession;
  xcodebuildOperation?: XcodebuildOperation;
  progressSink?: (event: ProgressEvent) => void;
}

export class DefaultToolExecutionContext implements ToolExecutionContext {
  private readonly progressEvents: ProgressEvent[] = [];
  private readonly attachments: ToolAttachment[] = [];
  private readonly renderSession?: RenderSession;
  private readonly progressSink?: (event: ProgressEvent) => void;
  private readonly adapter: DomainResultPipelineEventAdapter;
  private result?: ToolDomainResult;

  constructor(options: DefaultToolExecutionContextOptions = {}) {
    this.renderSession = options.renderSession;
    this.progressSink = options.progressSink;
    this.adapter = new DomainResultPipelineEventAdapter({
      xcodebuildOperation: options.xcodebuildOperation,
    });
  }

  emitProgress(event: ProgressEvent): void {
    this.progressEvents.push(event);
    this.progressSink?.(event);

    if (!this.renderSession) {
      return;
    }

    for (const pipelineEvent of this.adapter.adaptProgressEvent(event)) {
      this.renderSession.emit(pipelineEvent);
    }
  }

  attach(image: ToolAttachment): void {
    this.attachments.push(image);
  }

  emitResult(result: ToolDomainResult): PipelineEvent[] {
    this.result = result;

    const pipelineEvents = this.adapter.adaptResult(result);

    if (this.renderSession) {
      for (const event of pipelineEvents) {
        this.renderSession.emit(event);
      }
    }

    return pipelineEvents;
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
