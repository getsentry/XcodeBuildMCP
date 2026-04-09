import type { ToolResponse, NextStep, OutputStyle } from '../../types/common.ts';

// Shim: createErrorResponse was removed in the handler-contract refactor but
// ~35 consumer files still import it. They will be migrated in PRs 6-9.
export function createErrorResponse(message: string, details?: string): ToolResponse {
  const detailText = details ? `\nDetails: ${details}` : '';
  return {
    content: [{ type: 'text', text: `Error: ${message}${detailText}` }],
    isError: true,
  };
}

// Shim: createTextResponse was removed from validation.ts
export function createTextResponse(message: string, isError = false): ToolResponse {
  return {
    content: [{ type: 'text', text: message }],
    ...(isError ? { isError: true } : {}),
  };
}

export {
  DependencyError,
  AxeError,
  SystemError,
  ValidationError,
} from '../errors.ts';
export {
  processToolResponse,
  renderNextStep,
  renderNextStepsSection,
} from './next-steps-renderer.ts';

export type { ToolResponse, NextStep, OutputStyle };
