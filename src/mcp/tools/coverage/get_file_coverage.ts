/**
 * Coverage Tool: Get File Coverage
 *
 * Shows function-level coverage and optionally uncovered line ranges
 * for a specific file from an xcresult bundle.
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
import { header, statusLine, section, fileRef } from '../../../utils/tool-event-builders.ts';

const getFileCoverageSchema = z.object({
  xcresultPath: z.string().describe('Path to the .xcresult bundle'),
  file: z.string().describe('Source file name or path to inspect'),
  showLines: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, include uncovered line ranges from the archive'),
});

type GetFileCoverageParams = z.infer<typeof getFileCoverageSchema>;

interface CoverageFunction {
  coveredLines: number;
  executableLines: number;
  executionCount: number;
  lineCoverage: number;
  lineNumber: number;
  name: string;
}

interface RawFileEntry {
  file?: string;
  path?: string;
  name?: string;
  coveredLines?: number;
  executableLines?: number;
  lineCoverage?: number;
  functions?: CoverageFunction[];
}

interface FileFunctionCoverage {
  filePath: string;
  coveredLines: number;
  executableLines: number;
  lineCoverage: number;
  functions: CoverageFunction[];
}

function normalizeFileEntry(raw: RawFileEntry): FileFunctionCoverage {
  const functions = raw.functions ?? [];
  const coveredLines =
    raw.coveredLines ?? functions.reduce((sum, fn) => sum + fn.coveredLines, 0);
  const executableLines =
    raw.executableLines ?? functions.reduce((sum, fn) => sum + fn.executableLines, 0);
  const lineCoverage =
    raw.lineCoverage ?? (executableLines > 0 ? coveredLines / executableLines : 0);
  const filePath = raw.file ?? raw.path ?? raw.name ?? 'unknown';
  return { filePath, coveredLines, executableLines, lineCoverage, functions };
}

type GetFileCoverageContext = {
  executor: CommandExecutor;
  fileSystem: FileSystemExecutor;
};

export async function get_file_coverageLogic(
  params: GetFileCoverageParams,
  context: GetFileCoverageContext,
): Promise<void> {
  const ctx = getHandlerContext();
  const { xcresultPath, file, showLines } = params;

  const headerEvent = header('File Coverage', [
    { label: 'xcresult', value: xcresultPath },
    { label: 'File', value: file },
  ]);

  const fileExistsValidation = validateFileExists(xcresultPath, context.fileSystem);
  if (!fileExistsValidation.isValid) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', fileExistsValidation.errorMessage!));
    return;
  }

  log('info', `Getting file coverage for "${file}" from: ${xcresultPath}`);

  const funcResult = await context.executor(
    ['xcrun', 'xccov', 'view', '--report', '--functions-for-file', file, '--json', xcresultPath],
    'Get File Function Coverage',
    false,
  );

  if (!funcResult.success) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', `Failed to get file coverage: ${funcResult.error ?? funcResult.output}`));
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(funcResult.output);
  } catch {
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine('error', `Failed to parse coverage JSON output.\n\nRaw output:\n${funcResult.output}`),
    );
    return;
  }

  let fileEntries: FileFunctionCoverage[] = [];

  if (Array.isArray(data)) {
    fileEntries = (data as RawFileEntry[]).map(normalizeFileEntry);
  } else if (
    typeof data === 'object' &&
    data !== null &&
    'targets' in data &&
    Array.isArray((data as { targets: unknown }).targets)
  ) {
    const targets = (data as { targets: unknown[] }).targets;
    for (const t of targets) {
      if (typeof t !== 'object' || t === null) continue;
      const target = t as { files?: RawFileEntry[] };
      if (target.files) {
        fileEntries.push(...target.files.map(normalizeFileEntry));
      }
    }
  }

  if (fileEntries.length === 0) {
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine(
        'error',
        `No coverage data found for "${file}".\n\nMake sure the file name or path is correct and that tests covered this file.`,
      ),
    );
    return;
  }

  ctx.emit(headerEvent);

  for (const entry of fileEntries) {
    const filePct = (entry.lineCoverage * 100).toFixed(1);
    ctx.emit(fileRef(entry.filePath, 'File'));
    ctx.emit(
      statusLine(
        'info',
        `Coverage: ${filePct}% (${entry.coveredLines}/${entry.executableLines} lines)`,
      ),
    );

    if (entry.functions && entry.functions.length > 0) {
      const notCovered = entry.functions
        .filter((fn) => fn.coveredLines === 0)
        .sort((a, b) => b.executableLines - a.executableLines || a.lineNumber - b.lineNumber);

      const partial = entry.functions
        .filter((fn) => fn.coveredLines > 0 && fn.coveredLines < fn.executableLines)
        .sort((a, b) => a.lineCoverage - b.lineCoverage || a.lineNumber - b.lineNumber);

      const full = entry.functions.filter(
        (fn) => fn.executableLines > 0 && fn.coveredLines === fn.executableLines,
      );

      if (notCovered.length > 0) {
        const totalMissedLines = notCovered.reduce((sum, fn) => sum + fn.executableLines, 0);
        const notCoveredLines = notCovered.map(
          (fn) => `L${fn.lineNumber}  ${fn.name} -- 0/${fn.executableLines} lines`,
        );
        ctx.emit(
          section(
            `Not Covered (${notCovered.length} ${notCovered.length === 1 ? 'function' : 'functions'}, ${totalMissedLines} lines)`,
            notCoveredLines,
            { icon: 'red-circle' },
          ),
        );
      }

      if (partial.length > 0) {
        const partialLines = partial.map((fn) => {
          const fnPct = (fn.lineCoverage * 100).toFixed(1);
          return `L${fn.lineNumber}  ${fn.name} -- ${fnPct}% (${fn.coveredLines}/${fn.executableLines} lines)`;
        });
        ctx.emit(
          section(
            `Partial Coverage (${partial.length} ${partial.length === 1 ? 'function' : 'functions'})`,
            partialLines,
            { icon: 'yellow-circle' },
          ),
        );
      }

      if (full.length > 0) {
        ctx.emit(
          section(
            `Full Coverage (${full.length} ${full.length === 1 ? 'function' : 'functions'}) -- all at 100%`,
            [],
            { icon: 'green-circle' },
          ),
        );
      }
    }
  }

  if (showLines) {
    const filePath = fileEntries[0].filePath !== 'unknown' ? fileEntries[0].filePath : file;
    const archiveResult = await context.executor(
      ['xcrun', 'xccov', 'view', '--archive', '--file', filePath, xcresultPath],
      'Get File Line Coverage',
      false,
    );

    if (archiveResult.success && archiveResult.output) {
      const uncoveredRanges = parseUncoveredLines(archiveResult.output);
      if (uncoveredRanges.length > 0) {
        const rangeLines = uncoveredRanges.map((range) =>
          range.start === range.end ? `L${range.start}` : `L${range.start}-${range.end}`,
        );
        ctx.emit(section(`Uncovered line ranges (${filePath})`, rangeLines));
      } else {
        ctx.emit(statusLine('success', 'All executable lines are covered.'));
      }
    } else {
      ctx.emit(statusLine('warning', 'Could not retrieve line-level coverage from archive.'));
    }
  }

  ctx.nextStepParams = {
    get_coverage_report: { xcresultPath },
  };
}

interface LineRange {
  start: number;
  end: number;
}

/**
 * Parse xccov archive output to find uncovered line ranges.
 * Each line starts with the line number, a colon, and a count (0 = uncovered, * = non-executable).
 * Example:
 *   1: *
 *   2: 1
 *   3: 0
 *   4: 0
 *   5: 1
 * Lines with count 0 are uncovered.
 */
function parseUncoveredLines(output: string): LineRange[] {
  const ranges: LineRange[] = [];
  let currentRange: LineRange | null = null;

  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+):\s+(\S+)/);
    if (!match) continue;

    const lineNum = parseInt(match[1], 10);
    const count = match[2];

    if (count === '0') {
      if (currentRange) {
        currentRange.end = lineNum;
      } else {
        currentRange = { start: lineNum, end: lineNum };
      }
    } else {
      if (currentRange) {
        ranges.push(currentRange);
        currentRange = null;
      }
    }
  }

  if (currentRange) {
    ranges.push(currentRange);
  }

  return ranges;
}

export const schema = getFileCoverageSchema.shape;

export const handler = createTypedToolWithContext(
  getFileCoverageSchema,
  get_file_coverageLogic,
  () => ({
    executor: getDefaultCommandExecutor(),
    fileSystem: getDefaultFileSystemExecutor(),
  }),
);
