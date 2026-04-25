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

const codesignBaseSchema = z.object({
  targetPath: z.string().min(1).describe('Path to .app or .dmg to sign'),
  identity: z
    .string()
    .min(1)
    .describe('Code signing identity (e.g. "Developer ID Application: Name (TEAM)")'),
  entitlements: z.string().min(1).optional().describe('Path to .entitlements file'),
  notarize: z
    .boolean()
    .optional()
    .describe('Submit for notarization after signing (default: false)'),
  keychainProfile: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Keychain profile name for notarization credentials (created via `xcrun notarytool store-credentials`). Required for notarization unless NOTARYTOOL env vars are set.',
    ),
  teamId: z.string().min(1).optional().describe('Apple Team ID (required for notarization)'),
  bundleId: z.string().min(1).optional().describe('Bundle ID (required for notarization)'),
});

const codesignSchema = codesignBaseSchema.refine((val) => !val.notarize || val.teamId != null, {
  message: 'teamId is required when notarize is true',
  path: ['teamId'],
});

type CodesignParams = z.infer<typeof codesignSchema>;

export async function codesignLogic(
  params: CodesignParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const commandLabel = 'codesign';
  const outputParts: string[] = [];

  if (!/\.(app|dmg)$/.test(params.targetPath)) {
    const result = createCommandFailure(
      commandLabel,
      `targetPath must end with .app or .dmg: ${params.targetPath}`,
    );
    setStructuredOutput(ctx, result);
    return;
  }

  if (params.entitlements != null && !params.entitlements.endsWith('.entitlements')) {
    const result = createCommandFailure(
      commandLabel,
      `entitlements path must end with .entitlements: ${params.entitlements}`,
    );
    setStructuredOutput(ctx, result);
    return;
  }

  // Step 1: Sign
  const signCommand: string[] = [
    'codesign',
    '--force',
    '--options',
    'runtime',
    '--sign',
    params.identity,
  ];
  if (params.entitlements != null) {
    signCommand.push('--entitlements', params.entitlements);
  }
  signCommand.push(params.targetPath);

  try {
    const signResponse = await executor(signCommand, 'Code Signing', false);
    if (!signResponse.success) {
      const errorMessage = signResponse.error ?? signResponse.output ?? 'Code signing failed';
      const result = createCommandFailure(
        commandLabel,
        errorMessage,
        createBasicDiagnostics({ errors: [errorMessage], rawOutput: signResponse.output }),
      );
      setStructuredOutput(ctx, result);
      return;
    }
    outputParts.push(`[sign] ${signResponse.output}`);

    // Step 2: Verify
    const verifyResponse = await executor(
      ['codesign', '--verify', '--deep', '--strict', params.targetPath],
      'Code Sign Verification',
      false,
    );
    if (!verifyResponse.success) {
      const errorMessage =
        verifyResponse.error ?? verifyResponse.output ?? 'Code sign verification failed';
      const result = createCommandFailure(
        commandLabel,
        errorMessage,
        createBasicDiagnostics({ errors: [errorMessage], rawOutput: verifyResponse.output }),
      );
      setStructuredOutput(ctx, result);
      return;
    }
    outputParts.push(`[verify] ${verifyResponse.output}`);

    // Step 3: Notarize (optional)
    if (params.notarize) {
      const notarizeCommand: string[] = [
        'xcrun',
        'notarytool',
        'submit',
        params.targetPath,
        '--team-id',
        params.teamId!,
      ];
      if (params.keychainProfile != null) {
        notarizeCommand.push('--keychain-profile', params.keychainProfile);
      }
      notarizeCommand.push('--wait');

      const notarizeResponse = await executor(notarizeCommand, 'Notarization', false);
      if (!notarizeResponse.success) {
        const errorMessage =
          notarizeResponse.error ?? notarizeResponse.output ?? 'Notarization failed';
        const result = createCommandFailure(
          commandLabel,
          errorMessage,
          createBasicDiagnostics({ errors: [errorMessage], rawOutput: notarizeResponse.output }),
        );
        setStructuredOutput(ctx, result);
        return;
      }
      outputParts.push(`[notarize] ${notarizeResponse.output}`);

      // Step 4: Staple
      const stapleResponse = await executor(
        ['xcrun', 'stapler', 'staple', params.targetPath],
        'Stapling',
        false,
      );
      if (!stapleResponse.success) {
        const errorMessage = stapleResponse.error ?? stapleResponse.output ?? 'Stapling failed';
        const result = createCommandFailure(
          commandLabel,
          errorMessage,
          createBasicDiagnostics({ errors: [errorMessage], rawOutput: stapleResponse.output }),
        );
        setStructuredOutput(ctx, result);
        return;
      }
      outputParts.push(`[staple] ${stapleResponse.output}`);
    }

    const result = createCommandSuccess(
      commandLabel,
      outputParts.join('\n'),
      createBasicDiagnostics({ rawOutput: outputParts }),
    );
    setStructuredOutput(ctx, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = createCommandFailure(commandLabel, message);
    setStructuredOutput(ctx, result);
  }
}

export const schema = codesignBaseSchema.shape;

export const handler = createTypedTool(codesignSchema, codesignLogic, getDefaultCommandExecutor);
