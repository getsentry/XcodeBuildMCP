/**
 * Runtime status fragment — a renderer-local construct for infrastructure
 * and error messages emitted by the runtime layer (tool invoker, validation,
 * daemon bridge, etc.).  Not part of the canonical DomainFragment model.
 */
export interface RuntimeStatusFragment {
  kind: 'infrastructure';
  fragment: 'status';
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export function infrastructureStatus(
  level: RuntimeStatusFragment['level'],
  message: string,
): RuntimeStatusFragment {
  return { kind: 'infrastructure', fragment: 'status', level, message };
}
