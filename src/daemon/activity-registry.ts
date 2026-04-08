const activityCounts = new Map<string, number>();

function incrementActivity(key: string): void {
  activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
}

function decrementActivity(key: string): void {
  const current = activityCounts.get(key) ?? 0;
  if (current <= 1) {
    activityCounts.delete(key);
    return;
  }
  activityCounts.set(key, current - 1);
}

/**
 * Acquire a long-running daemon activity lease.
 * Call the returned release function once the activity has finished.
 */
export function acquireDaemonActivity(activityKey: string): () => void {
  const key = activityKey.trim();
  if (!key) {
    throw new Error('activityKey must be a non-empty string');
  }

  incrementActivity(key);

  let released = false;
  return (): void => {
    if (released) {
      return;
    }
    released = true;
    decrementActivity(key);
  };
}

export interface DaemonActivitySnapshot {
  activeOperationCount: number;
  byCategory: Record<string, number>;
}

export function getDaemonActivitySnapshot(): DaemonActivitySnapshot {
  const byCategory = Object.fromEntries(
    Array.from(activityCounts.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
  const activeOperationCount = Array.from(activityCounts.values()).reduce(
    (accumulator, count) => accumulator + count,
    0,
  );
  return {
    activeOperationCount,
    byCategory,
  };
}

/**
 * Test helper to reset shared process-local activity state.
 */
export function clearDaemonActivityRegistry(): void {
  activityCounts.clear();
}
