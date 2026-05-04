import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isPidAlive } from './process-liveness.ts';
import {
  FS_LOCK_OWNER_FILE,
  fsLockOwnersEqual,
  guardDirForLockDir,
  isFsLockOwner,
  type FsLockOwner,
} from './fs-lock-shared.ts';

export { FS_LOCK_OWNER_FILE, type FsLockOwner } from './fs-lock-shared.ts';

export interface AcquiredFsLock {
  readonly owner: FsLockOwner;
  release(): Promise<void>;
}

export interface TryAcquireFsLockOptions {
  lockDir: string;
  purpose: string;
  leaseMs: number;
  now?: number;
  pid?: number;
}

async function readLockOwner(lockDir: string): Promise<FsLockOwner | null> {
  try {
    const raw = await fs.readFile(path.join(lockDir, FS_LOCK_OWNER_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isFsLockOwner(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function removeLockDir(lockDir: string): Promise<void> {
  try {
    await fs.rm(lockDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function isDirectoryOlderThan(dir: string, now: number, ageMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return now - stat.mtimeMs > ageMs;
  } catch {
    return false;
  }
}

async function quarantineLockDir(lockDir: string): Promise<string | null> {
  const quarantineDir = path.join(
    path.dirname(lockDir),
    `.${path.basename(lockDir)}.stale.${process.pid}.${randomUUID()}`,
  );

  try {
    await fs.rename(lockDir, quarantineDir);
    return quarantineDir;
  } catch {
    return null;
  }
}

async function restoreQuarantinedLockDir(quarantineDir: string, lockDir: string): Promise<void> {
  try {
    await fs.rename(quarantineDir, lockDir);
  } catch {
    // Another contender may already have acquired the lock. Leave the quarantined
    // directory intact rather than deleting a lock we could not validate.
  }
}

async function shouldRecoverLockDir(
  lockDir: string,
  purpose: string,
  now: number,
  leaseMs: number,
): Promise<{ recover: false } | { recover: true; owner: FsLockOwner | null }> {
  const staleOwner = await readLockOwner(lockDir);
  if (!staleOwner) {
    return (await isDirectoryOlderThan(lockDir, now, leaseMs))
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

async function tryRecoverExpiredLockDir(
  lockDir: string,
  purpose: string,
  now: number,
  leaseMs: number,
): Promise<boolean> {
  const recovery = await shouldRecoverLockDir(lockDir, purpose, now, leaseMs);
  if (!recovery.recover) {
    return false;
  }

  const quarantineDir = await quarantineLockDir(lockDir);
  if (!quarantineDir) {
    return false;
  }

  if (recovery.owner) {
    const quarantinedOwner = await readLockOwner(quarantineDir);
    if (!fsLockOwnersEqual(quarantinedOwner, recovery.owner)) {
      await restoreQuarantinedLockDir(quarantineDir, lockDir);
      return false;
    }
  }

  await removeLockDir(quarantineDir);
  return true;
}

async function createLock(lockDir: string, owner: FsLockOwner): Promise<AcquiredFsLock> {
  await fs.mkdir(lockDir, { mode: 0o700 });
  try {
    await fs.writeFile(path.join(lockDir, FS_LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    await removeLockDir(lockDir);
    throw error;
  }

  return {
    owner,
    async release(): Promise<void> {
      const currentOwner = await readLockOwner(lockDir);
      if (currentOwner?.token !== owner.token) {
        return;
      }
      await fs.rm(lockDir, { recursive: true, force: true });
    },
  };
}

async function tryAcquireGuard(
  lockDir: string,
  purpose: string,
  leaseMs: number,
  now: number,
): Promise<AcquiredFsLock | null> {
  const guardDir = guardDirForLockDir(lockDir);
  const guardOwner: FsLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    purpose: `${purpose}:guard`,
    acquiredAtMs: now,
    expiresAtMs: now + leaseMs,
  };

  try {
    return await createLock(guardDir, guardOwner);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      return null;
    }
    const recovered = await tryRecoverExpiredLockDir(guardDir, guardOwner.purpose, now, leaseMs);
    if (!recovered) {
      return null;
    }
    try {
      return await createLock(guardDir, guardOwner);
    } catch {
      return null;
    }
  }
}

export async function tryAcquireFsLock(
  options: TryAcquireFsLockOptions,
): Promise<AcquiredFsLock | null> {
  const now = options.now ?? Date.now();
  const owner: FsLockOwner = {
    token: randomUUID(),
    pid: options.pid ?? process.pid,
    purpose: options.purpose,
    acquiredAtMs: now,
    expiresAtMs: now + options.leaseMs,
  };

  try {
    await fs.mkdir(path.dirname(options.lockDir), { recursive: true, mode: 0o700 });
    const guard = await tryAcquireGuard(options.lockDir, options.purpose, options.leaseMs, now);
    if (!guard) {
      return null;
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await createLock(options.lockDir, owner);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EEXIST') {
            return null;
          }

          const recovered = await tryRecoverExpiredLockDir(
            options.lockDir,
            options.purpose,
            now,
            options.leaseMs,
          );
          if (!recovered) {
            return null;
          }
        }
      }
    } finally {
      await guard.release();
    }
  } catch {
    return null;
  }

  return null;
}
