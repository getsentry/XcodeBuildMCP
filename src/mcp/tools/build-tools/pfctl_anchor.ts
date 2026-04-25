import * as z from 'zod';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import {
  setStructuredOutput,
  createCommandSuccess,
  createCommandFailure,
} from './command-result-helpers.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

const pfctlBaseSchema = z.object({
  anchorName: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/,
      'anchorName must match [a-zA-Z0-9._-] segments separated by / (e.g. "com.splitTunnel" or "com.splitTunnel/bypass")',
    )
    .describe('PF anchor name (e.g. "com.splitTunnel" or "com.splitTunnel/bypass")'),
  action: z
    .enum(['show-rules', 'show-all', 'test-syntax'])
    .describe('Action: show-rules (-sr), show-all (-sa), or test-syntax (-n -f)'),
  rulesFile: z.string().min(1).optional().describe('Rules file path (only for test-syntax action)'),
});

const pfctlSchema = pfctlBaseSchema.refine(
  (val) => val.action !== 'test-syntax' || val.rulesFile != null,
  { message: 'rulesFile is required for test-syntax action', path: ['rulesFile'] },
);

type PfctlParams = z.infer<typeof pfctlSchema>;

function buildCommand(params: PfctlParams): string[] {
  const base = ['sudo', '-n', 'pfctl', '-a', params.anchorName];

  switch (params.action) {
    case 'show-rules':
      return [...base, '-sr'];
    case 'show-all':
      return [...base, '-sa'];
    case 'test-syntax':
      return [...base, '-n', '-f', params.rulesFile!];
  }
}

export async function pfctlLogic(params: PfctlParams, executor: CommandExecutor): Promise<void> {
  const ctx = getHandlerContext();
  const commandLabel = `pfctl -a ${params.anchorName} (${params.action})`;

  if (params.action === 'test-syntax' && params.rulesFile != null) {
    if (!/\.(conf|rules)$/.test(params.rulesFile)) {
      const result = createCommandFailure(
        commandLabel,
        `rulesFile must end with .conf or .rules: ${params.rulesFile}`,
      );
      setStructuredOutput(ctx, result);
      return;
    }
  }

  const command = buildCommand(params);

  try {
    const response = await executor(command, 'PF Anchor Inspection', false);

    if (response.success) {
      const result = createCommandSuccess(
        commandLabel,
        response.output,
        createBasicDiagnostics({ rawOutput: response.output }),
      );
      setStructuredOutput(ctx, result);
    } else {
      const errorMessage = response.error ?? response.output ?? 'pfctl command failed';
      const result = createCommandFailure(
        commandLabel,
        errorMessage,
        createBasicDiagnostics({ errors: [errorMessage], rawOutput: response.output }),
      );
      setStructuredOutput(ctx, result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = createCommandFailure(commandLabel, message);
    setStructuredOutput(ctx, result);
  }
}

export { buildCommand as _buildCommand };

export const schema = pfctlBaseSchema.shape;

export const handler = createTypedTool(pfctlSchema, pfctlLogic, getDefaultCommandExecutor);
