import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  FS_LOCK_OWNER_FILE,
  fsLockOwnersEqual,
  guardDirForLockDir,
  isFsLockOwner,
  type FsLockOwner,
} from './fs-lock-shared.ts';
import { isPidAlive } from './process-liveness.ts';

export interface AcquiredFsLockSync {
  readonly owner: FsLockOwner;
  release(): void;
}

export interface TryAcquireFsLockSyncOptions {
  lockDir: string;
  purpose: string;
  leaseMs: number;
  now?: number;
  pid?: number;
}

function readLockOwnerSync(lockDir: string): FsLockOwner | null {
  try {
    const raw = readFileSync(join(lockDir, FS_LOCK_OWNER_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isFsLockOwner(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isDirectoryOlderThan(dir: string, now: number, ageMs: number): boolean {
  try {
    return now - statSync(dir).mtimeMs > ageMs;
  } catch {
    return false;
  }
}

function shouldRecoverLockDir(
  lockDir: string,
  purpose: string,
  now: number,
  leaseMs: number,
): { recover: false } | { recover: true; owner: FsLockOwner | null } {
  const staleOwner = readLockOwnerSync(lockDir);
  if (!staleOwner) {
    return isDirectoryOlderThan(lockDir, now, leaseMs)
      ? { recover: true, owner: null }
      : { recover: false };
  }
  if (
    staleOwner.purpose !== purpose ||
    staleOwner.expiresAtMs > now ||
    isPidAlive(staleOwner.pid)
  ) {
    return { recover: false };
  }
  return { recover: true, owner: staleOwner };
}

function tryRecoverExpiredLockDir(
  lockDir: string,
  purpose: string,
  now: number,
  leaseMs: number,
): boolean {
  const recovery = shouldRecoverLockDir(lockDir, purpose, now, leaseMs);
  if (!recovery.recover) {
    return false;
  }

  const quarantineDir = join(
    dirname(lockDir),
    `.${basename(lockDir)}.stale.${process.pid}.${randomUUID()}`,
  );
  try {
    renameSync(lockDir, quarantineDir);
  } catch {
    return false;
  }

  if (recovery.owner) {
    const quarantinedOwner = readLockOwnerSync(quarantineDir);
    if (!fsLockOwnersEqual(quarantinedOwner, recovery.owner)) {
      try {
        renameSync(quarantineDir, lockDir);
      } catch {
        // Leave quarantined dir intact rather than deleting a lock we could not validate.
      }
      return false;
    }
  }

  rmSync(quarantineDir, { recursive: true, force: true });
  return true;
}

function createLock(lockDir: string, owner: FsLockOwner): AcquiredFsLockSync {
  mkdirSync(lockDir, { mode: 0o700 });
  try {
    writeFileSync(join(lockDir, FS_LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    rmSync(lockDir, { recursive: true, force: true });
    throw error;
  }

  return {
    owner,
    release(): void {
      const currentOwner = readLockOwnerSync(lockDir);
      if (currentOwner?.token !== owner.token) {
        return;
      }
      rmSync(lockDir, { recursive: true, force: true });
    },
  };
}

function tryAcquireGuard(
  lockDir: string,
  purpose: string,
  leaseMs: number,
  now: number,
): AcquiredFsLockSync | null {
  const guardDir = guardDirForLockDir(lockDir);
  const guardOwner: FsLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    purpose: `${purpose}:guard`,
    acquiredAtMs: now,
    expiresAtMs: now + leaseMs,
  };

  try {
    return createLock(guardDir, guardOwner);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      return null;
    }
    if (!tryRecoverExpiredLockDir(guardDir, guardOwner.purpose, now, leaseMs)) {
      return null;
    }
    try {
      return createLock(guardDir, guardOwner);
    } catch {
      return null;
    }
  }
}

export function tryAcquireFsLockSync(
  options: TryAcquireFsLockSyncOptions,
): AcquiredFsLockSync | null {
  const now = options.now ?? Date.now();
  const owner: FsLockOwner = {
    token: randomUUID(),
    pid: options.pid ?? process.pid,
    purpose: options.purpose,
    acquiredAtMs: now,
    expiresAtMs: now + options.leaseMs,
  };

  try {
    mkdirSync(dirname(options.lockDir), { recursive: true, mode: 0o700 });
    const guard = tryAcquireGuard(options.lockDir, options.purpose, options.leaseMs, now);
    if (!guard) {
      return null;
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return createLock(options.lockDir, owner);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            return null;
          }
          if (!tryRecoverExpiredLockDir(options.lockDir, options.purpose, now, options.leaseMs)) {
            return null;
          }
        }
      }
    } finally {
      guard.release();
    }
  } catch {
    return null;
  }

  return null;
}
