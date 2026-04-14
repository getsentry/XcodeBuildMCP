import type {
  DetailTreeProgressEvent,
  FileRefProgressEvent,
  HeaderProgressEvent,
  NextStepsProgressEvent,
  SectionProgressEvent,
  StatusProgressEvent,
  TableProgressEvent,
} from '../types/progress-events.ts';

export function header(
  operation: string,
  params?: Array<{ label: string; value: string }>,
): HeaderProgressEvent {
  return {
    type: 'header',
    operation,
    params: params ?? [],
  };
}

export function section(
  title: string,
  lines: string[],
  opts?: { icon?: SectionProgressEvent['icon']; blankLineAfterTitle?: boolean },
): SectionProgressEvent {
  return {
    type: 'section',
    title,
    icon: opts?.icon,
    lines,
    blankLineAfterTitle: opts?.blankLineAfterTitle,
  };
}

export function statusLine(
  level: StatusProgressEvent['level'],
  message: string,
): StatusProgressEvent {
  return {
    type: 'status',
    level,
    message,
  };
}

export function fileRef(path: string, label?: string): FileRefProgressEvent {
  return {
    type: 'file-ref',
    label,
    path,
  };
}

export function table(
  columns: string[],
  rows: Array<Record<string, string>>,
  heading?: string,
): TableProgressEvent {
  return {
    type: 'table',
    name: heading ?? 'table',
    ...(heading ? { heading } : {}),
    columns,
    rows,
  };
}

export function detailTree(
  items: Array<{ label: string; value: string }>,
): DetailTreeProgressEvent {
  return {
    type: 'detail-tree',
    items,
  };
}

export function nextSteps(steps: NextStepsProgressEvent['steps']): NextStepsProgressEvent {
  return {
    type: 'next-steps',
    steps,
  };
}
