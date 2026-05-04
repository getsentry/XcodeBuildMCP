export interface FsLockOwner {
  token: string;
  pid: number;
  purpose: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export const FS_LOCK_OWNER_FILE = 'owner.json';

export function isFsLockOwner(value: unknown): value is FsLockOwner {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const owner = value as Partial<FsLockOwner>;
  return (
    typeof owner.token === 'string' &&
    owner.token.length > 0 &&
    typeof owner.pid === 'number' &&
    Number.isInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.purpose === 'string' &&
    owner.purpose.length > 0 &&
    typeof owner.acquiredAtMs === 'number' &&
    Number.isFinite(owner.acquiredAtMs) &&
    typeof owner.expiresAtMs === 'number' &&
    Number.isFinite(owner.expiresAtMs)
  );
}

export function fsLockOwnersEqual(left: FsLockOwner | null, right: FsLockOwner): boolean {
  return (
    left?.token === right.token &&
    left.pid === right.pid &&
    left.purpose === right.purpose &&
    left.acquiredAtMs === right.acquiredAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}

export function guardDirForLockDir(lockDir: string): string {
  return `${lockDir}.guard`;
}
