import * as fs from 'fs';
import type { ValidationResult } from '../types/common.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';

export function validateFileExists(
  filePath: string,
  fileSystem?: FileSystemExecutor,
): ValidationResult {
  const exists = fileSystem ? fileSystem.existsSync(filePath) : fs.existsSync(filePath);
  if (!exists) {
    return {
      isValid: false,
      errorMessage: `File not found: '${filePath}'. Please check the path and try again.`,
    };
  }

  return { isValid: true };
}
