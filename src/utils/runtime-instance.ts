import { randomUUID } from 'node:crypto';

const DEFAULT_WORKSPACE_KEY = 'default';

export interface RuntimeInstance {
  instanceId: string;
  pid: number;
  workspaceKey: string;
}

let configuredWorkspaceKey: string | null = null;
let runtimeInstance: RuntimeInstance | null = null;

export function configureRuntimeWorkspaceKey(workspaceKey: string): void {
  const normalized = workspaceKey.trim();
  if (!normalized) {
    throw new Error('Workspace key cannot be empty');
  }
  configuredWorkspaceKey = normalized;
  if (runtimeInstance) {
    runtimeInstance = { ...runtimeInstance, workspaceKey: normalized };
  }
}

export function getRuntimeInstance(): RuntimeInstance {
  const workspaceKey = configuredWorkspaceKey;
  if (!workspaceKey) {
    throw new Error('Runtime workspace key has not been configured');
  }

  runtimeInstance ??= {
    instanceId: randomUUID(),
    pid: process.pid,
    workspaceKey,
  };
  return runtimeInstance;
}

export function getRuntimeInstanceIfConfigured(): RuntimeInstance | null {
  if (runtimeInstance) {
    return runtimeInstance;
  }
  if (!configuredWorkspaceKey) {
    return null;
  }
  return getRuntimeInstance();
}

export function setRuntimeInstanceForTests(
  instance:
    | (Omit<RuntimeInstance, 'workspaceKey'> & Partial<Pick<RuntimeInstance, 'workspaceKey'>>)
    | null,
): void {
  runtimeInstance = instance
    ? {
        instanceId: instance.instanceId,
        pid: instance.pid,
        workspaceKey: instance.workspaceKey ?? configuredWorkspaceKey ?? DEFAULT_WORKSPACE_KEY,
      }
    : null;
  configuredWorkspaceKey = runtimeInstance?.workspaceKey ?? null;
}
