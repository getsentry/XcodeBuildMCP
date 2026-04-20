import type { ToolDomainResult } from '../../types/domain-results.js';
import type { DomainFragment } from '../../types/domain-fragments.js';
import type {
  ToolAttachment,
  DomainStreamingExecutionContext,
} from '../../types/tool-execution.js';

export interface DefaultToolExecutionContextOptions {
  liveProgressEnabled?: boolean;
  onFragment?: (fragment: DomainFragment) => void;
}

export class DefaultToolExecutionContext implements DomainStreamingExecutionContext {
  readonly liveProgressEnabled: boolean;
  private readonly attachments: ToolAttachment[] = [];
  private readonly fragmentCallback?: (fragment: DomainFragment) => void;
  private result?: ToolDomainResult;

  constructor(options: DefaultToolExecutionContextOptions = {}) {
    this.liveProgressEnabled = options.liveProgressEnabled ?? true;
    this.fragmentCallback = options.onFragment;
  }

  attach(image: ToolAttachment): void {
    this.attachments.push(image);
  }

  emitFragment(fragment: DomainFragment): void {
    this.fragmentCallback?.(fragment);
  }

  emitResult(result: ToolDomainResult): void {
    this.result = result;
  }

  getAttachments(): readonly ToolAttachment[] {
    return [...this.attachments];
  }

  getResult(): ToolDomainResult | undefined {
    return this.result;
  }
}
