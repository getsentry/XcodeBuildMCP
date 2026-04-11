import { randomUUID } from 'node:crypto';

export interface RuntimeInstance {
  instanceId: string;
  pid: number;
}

let runtimeInstance: RuntimeInstance | null = null;

export function getRuntimeInstance(): RuntimeInstance {
  runtimeInstance ??= {
    instanceId: randomUUID(),
    pid: process.pid,
  };
  return runtimeInstance;
}

export function setRuntimeInstanceForTests(instance: RuntimeInstance | null): void {
  runtimeInstance = instance;
}
