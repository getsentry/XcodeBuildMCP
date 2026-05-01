import { randomUUID } from 'node:crypto';

export interface RuntimeInstance {
  instanceId: string;
  pid: number;
  workspaceKey: string;
}

let runtimeInstance: RuntimeInstance | null = null;
let runtimeWorkspaceKey: string | null = null;

export function configureRuntimeWorkspaceKey(workspaceKey: string): void {
  const normalizedWorkspaceKey = workspaceKey.trim();
  if (normalizedWorkspaceKey.length === 0) {
    throw new Error('Runtime workspace key cannot be empty');
  }

  runtimeWorkspaceKey = normalizedWorkspaceKey;
  if (runtimeInstance) {
    runtimeInstance = { ...runtimeInstance, workspaceKey: normalizedWorkspaceKey };
  }
}

export function getRuntimeInstance(): RuntimeInstance {
  if (runtimeInstance) {
    return runtimeInstance;
  }

  if (!runtimeWorkspaceKey) {
    throw new Error('Runtime workspace key has not been configured');
  }

  runtimeInstance = {
    instanceId: randomUUID(),
    pid: process.pid,
    workspaceKey: runtimeWorkspaceKey,
  };
  return runtimeInstance;
}

export function getRuntimeInstanceIfConfigured(): RuntimeInstance | null {
  if (runtimeInstance) {
    return runtimeInstance;
  }
  if (!runtimeWorkspaceKey) {
    return null;
  }
  return getRuntimeInstance();
}

export function setRuntimeInstanceForTests(instance: RuntimeInstance | null): void {
  runtimeInstance = instance;
  runtimeWorkspaceKey = instance?.workspaceKey ?? null;
}
