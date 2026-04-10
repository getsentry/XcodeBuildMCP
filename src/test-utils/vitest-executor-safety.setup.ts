/**
 * Vitest unit-test setup: installs blocking executor/spawner overrides.
 *
 * This ensures unit tests fail fast if they accidentally reach a real system
 * executor, filesystem, or interactive spawner without explicit mock injection.
 *
 * Only loaded by vitest.config.ts (unit tests). Snapshot and smoke configs
 * intentionally do NOT load this file.
 */

import { beforeEach, afterEach } from 'vitest';
import {
  __setTestCommandExecutorOverride,
  __setTestFileSystemExecutorOverride,
  __clearTestExecutorOverrides,
  __setTestInteractiveSpawnerOverride,
  __clearTestInteractiveSpawnerOverride,
} from '../utils/execution/index.ts';
import {
  createNoopExecutor,
  createNoopFileSystemExecutor,
  createNoopInteractiveSpawner,
} from './mock-executors.ts';

beforeEach(() => {
  __setTestCommandExecutorOverride(createNoopExecutor());
  __setTestFileSystemExecutorOverride(createNoopFileSystemExecutor());
  __setTestInteractiveSpawnerOverride(createNoopInteractiveSpawner());
});

afterEach(() => {
  __clearTestExecutorOverrides();
  __clearTestInteractiveSpawnerOverride();
});
