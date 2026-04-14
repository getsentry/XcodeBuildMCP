export interface StatusProgressEvent {
  type: 'status';
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}
export interface XcodebuildLineProgressEvent {
  type: 'xcodebuild-line';
  stream: 'stdout' | 'stderr';
  line: string;
}
export interface TableProgressEvent {
  type: 'table';
  name: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}
export interface ArtifactProgressEvent {
  type: 'artifact';
  name: string;
  path: string;
}
export type ProgressEvent =
  | StatusProgressEvent
  | XcodebuildLineProgressEvent
  | TableProgressEvent
  | ArtifactProgressEvent;
