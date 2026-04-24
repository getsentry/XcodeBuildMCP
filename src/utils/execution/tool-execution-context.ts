import type { DomainFragment } from '../../types/domain-fragments.ts';
import type { ToolAttachment, StreamingExecutionContext } from '../../types/tool-execution.ts';

export interface StreamingExecutionContextOptions {
  liveProgressEnabled?: boolean;
  onFragment?: (fragment: DomainFragment) => void;
}

export class DefaultStreamingExecutionContext implements StreamingExecutionContext {
  readonly liveProgressEnabled: boolean;
  private readonly attachments: ToolAttachment[] = [];
  private readonly fragmentCallback?: (fragment: DomainFragment) => void;

  constructor(options: StreamingExecutionContextOptions = {}) {
    this.liveProgressEnabled = options.liveProgressEnabled ?? true;
    this.fragmentCallback = options.onFragment;
  }

  attach(image: ToolAttachment): void {
    this.attachments.push(image);
  }

  emitFragment(fragment: DomainFragment): void {
    this.fragmentCallback?.(fragment);
  }

  getAttachments(): readonly ToolAttachment[] {
    return [...this.attachments];
  }
}
