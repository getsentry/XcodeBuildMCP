import { AsyncLocalStorage } from 'node:async_hooks';
import type { TranscriptFragment } from '../types/domain-fragments.ts';

export type TranscriptEmitter = (fragment: TranscriptFragment) => void;
export const transcriptEmitterStorage = new AsyncLocalStorage<TranscriptEmitter>();
