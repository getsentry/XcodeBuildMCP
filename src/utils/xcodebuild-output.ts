import type { NoticeLevel, XcodebuildOperation } from '../types/domain-fragments.ts';
import type { RuntimeStatusFragment } from '../types/runtime-status.ts';
import type { PipelineResult, StartedPipeline } from './xcodebuild-pipeline.ts';

interface FinalizeInlineXcodebuildOptions {
  started: StartedPipeline;
  succeeded: boolean;
  durationMs: number;
}

function formatBuildRunStepLabel(step: string): string {
  switch (step) {
    case 'resolve-app-path':
      return 'Resolving app path';
    case 'resolve-simulator':
      return 'Resolving simulator';
    case 'boot-simulator':
      return 'Booting simulator';
    case 'install-app':
      return 'Installing app';
    case 'extract-bundle-id':
      return 'Extracting bundle ID';
    case 'launch-app':
      return 'Launching app';
    default:
      return 'Running step';
  }
}

export function createNoticeFragment(
  _operation: XcodebuildOperation,
  message: string,
  level: NoticeLevel = 'info',
  options: {
    code?: string;
    data?: Record<string, string | number | boolean>;
  } = {},
): RuntimeStatusFragment {
  if (options.code === 'build-run-step' && options.data) {
    const data = options.data as { step: string; status?: string };
    return {
      kind: 'infrastructure',
      fragment: 'status',
      level: data.status === 'succeeded' ? 'success' : 'info',
      message: formatBuildRunStepLabel(data.step),
    };
  }

  const statusLevel: RuntimeStatusFragment['level'] =
    level === 'success' || level === 'warning' ? level : 'info';

  return {
    kind: 'infrastructure',
    fragment: 'status',
    level: statusLevel,
    message,
  };
}

export function finalizeInlineXcodebuild(options: FinalizeInlineXcodebuildOptions): PipelineResult {
  return options.started.pipeline.finalize(options.succeeded, options.durationMs);
}
