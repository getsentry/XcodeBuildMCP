/**
 * Focused execution facade.
 * Prefer importing from 'utils/execution/index.js' instead of the legacy utils barrel.
 */
export {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
  __setTestCommandExecutorOverride,
  __setTestFileSystemExecutorOverride,
  __clearTestExecutorOverrides,
} from '../command.ts';
export {
  getDefaultInteractiveSpawner,
  __setTestInteractiveSpawnerOverride,
  __clearTestInteractiveSpawnerOverride,
} from './interactive-process.ts';
export { DefaultStreamingExecutionContext } from './tool-execution-context.ts';
export type { StreamingExecutionContextOptions } from './tool-execution-context.ts';

// Types
export type { CommandExecutor, CommandResponse, CommandExecOptions } from '../CommandExecutor.ts';
export type { FileSystemExecutor } from '../FileSystemExecutor.ts';
export type {
  InteractiveProcess,
  InteractiveSpawner,
  SpawnInteractiveOptions,
} from './interactive-process.ts';
