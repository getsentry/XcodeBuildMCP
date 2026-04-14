import type { ToolDomainResult } from '../../types/domain-results.js';
import type { ProgressEvent, XcodebuildOperation } from '../../types/progress-events.js';
import type { ToolAttachment, ToolExecutionContext } from '../../types/tool-execution.js';
import { renderDomainResultTextItems } from '../renderers/domain-result-text.js';

export interface DefaultToolExecutionContextOptions {
  xcodebuildOperation?: XcodebuildOperation;
  progressSink?: (event: ProgressEvent) => void;
}

function isProgressEvent(
  item: ReturnType<typeof renderDomainResultTextItems>[number],
): item is ProgressEvent {
  return item.type !== 'summary';
}

function shouldAdaptResult(result: ToolDomainResult): boolean {
  switch (result.kind) {
    case 'doctor-report':
    case 'ui-action-result':
    case 'xcode-bridge-status':
    case 'xcode-bridge-sync':
    case 'xcode-bridge-tool-list':
    case 'xcode-bridge-call-result':
      return true;
    default:
      return false;
  }
}

function adaptDomainResultToProgressEvents(result: ToolDomainResult): ProgressEvent[] {
  if (!shouldAdaptResult(result)) {
    return [];
  }

  return renderDomainResultTextItems(result).filter(isProgressEvent);
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
    for (const event of adaptDomainResultToProgressEvents(result)) {
      this.emitProgress(event);
    }
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
