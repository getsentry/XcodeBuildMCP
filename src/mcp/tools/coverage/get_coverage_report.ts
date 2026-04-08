/**
 * Coverage Tool: Get Coverage Report
 *
 * Shows overall per-target code coverage from an xcresult bundle.
 * Uses `xcrun xccov view --report` to extract coverage data.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

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
): Promise<void> {
  const ctx = getHandlerContext();
  const { xcresultPath, target, showFiles } = params;

  const headerParams = [{ label: 'xcresult', value: xcresultPath }];
  if (target) {
    headerParams.push({ label: 'Target Filter', value: target });
  }
  const headerEvent = header('Coverage Report', headerParams);

  const fileExistsValidation = validateFileExists(xcresultPath, context.fileSystem);
  if (!fileExistsValidation.isValid) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', fileExistsValidation.errorMessage!));
    return;
  }

  log('info', `Getting coverage report from: ${xcresultPath}`);

  const cmd = ['xcrun', 'xccov', 'view', '--report'];
  if (!showFiles) {
    cmd.push('--only-targets');
  }
  cmd.push('--json', xcresultPath);

  const result = await context.executor(cmd, 'Get Coverage Report', false);

  if (!result.success) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', `Failed to get coverage report: ${result.error ?? result.output}`));
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(result.output);
  } catch {
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine('error', `Failed to parse coverage JSON output.\n\nRaw output:\n${result.output}`),
    );
    return;
  }

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
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', `Unexpected coverage data format.\n\nRaw output:\n${result.output}`));
    return;
  }

  let targets = rawTargets.filter(isValidCoverageTarget);

  if (target) {
    const lowerTarget = target.toLowerCase();
    targets = targets.filter((t) => t.name.toLowerCase().includes(lowerTarget));
    if (targets.length === 0) {
      ctx.emit(headerEvent);
      ctx.emit(statusLine('error', `No targets found matching "${target}".`));
      return;
    }
  }

  if (targets.length === 0) {
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine(
        'error',
        'No coverage data found in the xcresult bundle.\n\nMake sure tests were run with coverage enabled.',
      ),
    );
    return;
  }

  let totalCovered = 0;
  let totalExecutable = 0;
  for (const t of targets) {
    totalCovered += t.coveredLines;
    totalExecutable += t.executableLines;
  }
  const overallPct = totalExecutable > 0 ? (totalCovered / totalExecutable) * 100 : 0;

  targets.sort((a, b) => a.lineCoverage - b.lineCoverage);

  const targetLines: string[] = [];
  for (const t of targets) {
    const pct = (t.lineCoverage * 100).toFixed(1);
    targetLines.push(`${t.name}: ${pct}% (${t.coveredLines}/${t.executableLines} lines)`);

    if (showFiles && t.files && t.files.length > 0) {
      const sortedFiles = [...t.files].sort((a, b) => a.lineCoverage - b.lineCoverage);
      for (const f of sortedFiles) {
        const fPct = (f.lineCoverage * 100).toFixed(1);
        targetLines.push(`  ${f.name}: ${fPct}% (${f.coveredLines}/${f.executableLines} lines)`);
      }
    }
  }

  ctx.emit(headerEvent);
  ctx.emit(
    statusLine('info', `Overall: ${overallPct.toFixed(1)}% (${totalCovered}/${totalExecutable} lines)`),
  );
  ctx.emit(section('Targets', targetLines));
  ctx.nextStepParams = {
    get_file_coverage: { xcresultPath },
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
