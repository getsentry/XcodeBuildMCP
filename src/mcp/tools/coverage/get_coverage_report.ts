/**
 * Coverage Tool: Get Coverage Report
 *
 * Shows overall per-target code coverage from an xcresult bundle.
 * Uses `xcrun xccov view --report` to extract coverage data.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from '../../../utils/execution/index.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';

const getCoverageReportSchema = z.object({
  xcresultPath: z.string().describe('Path to the .xcresult bundle'),
  target: z.string().optional().describe('Filter results to a specific target name'),
  showFiles: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, include per-file coverage breakdown under each target'),
});

type GetCoverageReportParams = z.infer<typeof getCoverageReportSchema>;

interface CoverageFile {
  coveredLines: number;
  executableLines: number;
  lineCoverage: number;
  name: string;
  path: string;
}

interface CoverageTarget {
  coveredLines: number;
  executableLines: number;
  lineCoverage: number;
  name: string;
  files?: CoverageFile[];
}

function isValidCoverageTarget(value: unknown): value is CoverageTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CoverageTarget).name === 'string' &&
    typeof (value as CoverageTarget).coveredLines === 'number' &&
    typeof (value as CoverageTarget).executableLines === 'number' &&
    typeof (value as CoverageTarget).lineCoverage === 'number'
  );
}

type GetCoverageReportContext = {
  executor: CommandExecutor;
  fileSystem: FileSystemExecutor;
};

export async function get_coverage_reportLogic(
  params: GetCoverageReportParams,
  context: GetCoverageReportContext,
): Promise<ToolResponse> {
  const { xcresultPath, target, showFiles } = params;

  const fileExistsValidation = validateFileExists(xcresultPath, context.fileSystem);
  if (!fileExistsValidation.isValid) {
    return { content: [{ type: 'text', text: fileExistsValidation.errorMessage! }], isError: true };
  }

  log('info', `Getting coverage report from: ${xcresultPath}`);

  const cmd = ['xcrun', 'xccov', 'view', '--report'];
  if (!showFiles) {
    cmd.push('--only-targets');
  }
  cmd.push('--json', xcresultPath);

  const result = await context.executor(cmd, 'Get Coverage Report', false, undefined);

  if (!result.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to get coverage report: ${result.error ?? result.output}\n\nMake sure the xcresult bundle exists and contains coverage data.\nHint: Run tests with coverage enabled (e.g., xcodebuild test -enableCodeCoverage YES).`,
        },
      ],
      isError: true,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(result.output);
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to parse coverage JSON output.\n\nRaw output:\n${result.output}`,
        },
      ],
      isError: true,
    };
  }

  // Validate structure: expect an array of target objects or { targets: [...] }
  let rawTargets: unknown[] = [];
  if (Array.isArray(data)) {
    rawTargets = data;
  } else if (
    typeof data === 'object' &&
    data !== null &&
    'targets' in data &&
    Array.isArray((data as { targets: unknown }).targets)
  ) {
    rawTargets = (data as { targets: unknown[] }).targets;
  } else {
    return {
      content: [
        {
          type: 'text',
          text: `Unexpected coverage data format.\n\nRaw output:\n${result.output}`,
        },
      ],
      isError: true,
    };
  }

  let targets = rawTargets.filter(isValidCoverageTarget);

  // Filter by target name if specified
  if (target) {
    const lowerTarget = target.toLowerCase();
    targets = targets.filter((t) => t.name.toLowerCase().includes(lowerTarget));
    if (targets.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No targets found matching "${target}".`,
          },
        ],
        isError: true,
      };
    }
  }

  if (targets.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No coverage data found in the xcresult bundle.\n\nMake sure tests were run with coverage enabled.',
        },
      ],
      isError: true,
    };
  }

  // Build human-readable output
  let text = 'Code Coverage Report\n';
  text += '====================\n\n';

  // Calculate overall stats
  let totalCovered = 0;
  let totalExecutable = 0;
  for (const t of targets) {
    totalCovered += t.coveredLines;
    totalExecutable += t.executableLines;
  }
  const overallPct = totalExecutable > 0 ? (totalCovered / totalExecutable) * 100 : 0;
  text += `Overall: ${overallPct.toFixed(1)}% (${totalCovered}/${totalExecutable} lines)\n\n`;

  text += 'Targets:\n';
  // Sort by coverage ascending (lowest coverage first)
  targets.sort((a, b) => a.lineCoverage - b.lineCoverage);

  for (const t of targets) {
    const pct = (t.lineCoverage * 100).toFixed(1);
    text += `  ${t.name}: ${pct}% (${t.coveredLines}/${t.executableLines} lines)\n`;

    if (showFiles && t.files && t.files.length > 0) {
      const sortedFiles = [...t.files].sort((a, b) => a.lineCoverage - b.lineCoverage);
      for (const f of sortedFiles) {
        const fPct = (f.lineCoverage * 100).toFixed(1);
        text += `    ${f.name}: ${fPct}% (${f.coveredLines}/${f.executableLines} lines)\n`;
      }
      text += '\n';
    }
  }

  return {
    content: [{ type: 'text', text }],
    nextStepParams: {
      get_file_coverage: { xcresultPath },
    },
  };
}

export const schema = getCoverageReportSchema.shape;

export const handler = createTypedToolWithContext(
  getCoverageReportSchema,
  get_coverage_reportLogic,
  () => ({
    executor: getDefaultCommandExecutor(),
    fileSystem: getDefaultFileSystemExecutor(),
  }),
);
