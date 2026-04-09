/**
 * Coverage Tool: Get File Coverage
 *
 * Shows function-level coverage and optionally uncovered line ranges
 * for a specific file from an xcresult bundle.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from '../../../utils/execution/index.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';

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
): Promise<ToolResponse> {
  const { xcresultPath, file, showLines } = params;

  const fileExistsValidation = validateFileExists(xcresultPath, context.fileSystem);
  if (!fileExistsValidation.isValid) {
    return { content: [{ type: 'text', text: fileExistsValidation.errorMessage! }], isError: true };
  }

  log('info', `Getting file coverage for "${file}" from: ${xcresultPath}`);

  // Get function-level coverage
  const funcResult = await context.executor(
    ['xcrun', 'xccov', 'view', '--report', '--functions-for-file', file, '--json', xcresultPath],
    'Get File Function Coverage',
    false,
    undefined,
  );

  if (!funcResult.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to get file coverage: ${funcResult.error ?? funcResult.output}\n\nMake sure the xcresult bundle exists and contains coverage data for "${file}".`,
        },
      ],
      isError: true,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(funcResult.output);
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to parse coverage JSON output.\n\nRaw output:\n${funcResult.output}`,
        },
      ],
      isError: true,
    };
  }

  // The output can be:
  //   - An array of { file, functions } objects (xccov flat format)
  //   - { targets: [{ files: [...] }] } (nested format)
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
    return {
      content: [
        {
          type: 'text',
          text: `No coverage data found for "${file}".\n\nMake sure the file name or path is correct and that tests covered this file.`,
        },
      ],
      isError: true,
    };
  }

  // Build human-readable output
  let text = '';

  for (const entry of fileEntries) {
    const filePct = (entry.lineCoverage * 100).toFixed(1);
    text += `File: ${entry.filePath}\n`;
    text += `Coverage: ${filePct}% (${entry.coveredLines}/${entry.executableLines} lines)\n`;
    text += '---\n';

    if (entry.functions && entry.functions.length > 0) {
      // Sort functions by line number
      const sortedFuncs = [...entry.functions].sort((a, b) => a.lineNumber - b.lineNumber);

      text += 'Functions:\n';
      for (const fn of sortedFuncs) {
        const fnPct = (fn.lineCoverage * 100).toFixed(1);
        const marker = fn.coveredLines === 0 ? '[NOT COVERED] ' : '';
        text += `  ${marker}L${fn.lineNumber} ${fn.name}: ${fnPct}% (${fn.coveredLines}/${fn.executableLines} lines, called ${fn.executionCount}x)\n`;
      }

      // Summary of uncovered functions
      const uncoveredFuncs = sortedFuncs.filter((fn) => fn.coveredLines === 0);
      if (uncoveredFuncs.length > 0) {
        text += `\nUncovered functions (${uncoveredFuncs.length}):\n`;
        for (const fn of uncoveredFuncs) {
          text += `  - ${fn.name} (line ${fn.lineNumber})\n`;
        }
      }
    }

    text += '\n';
  }

  // Optionally get line-by-line coverage from the archive
  if (showLines) {
    const filePath = fileEntries[0].filePath !== 'unknown' ? fileEntries[0].filePath : file;
    const archiveResult = await context.executor(
      ['xcrun', 'xccov', 'view', '--archive', '--file', filePath, xcresultPath],
      'Get File Line Coverage',
      false,
      undefined,
    );

    if (archiveResult.success && archiveResult.output) {
      const uncoveredRanges = parseUncoveredLines(archiveResult.output);
      if (uncoveredRanges.length > 0) {
        text += `Uncovered line ranges (${filePath}):\n`;
        for (const range of uncoveredRanges) {
          if (range.start === range.end) {
            text += `  L${range.start}\n`;
          } else {
            text += `  L${range.start}-${range.end}\n`;
          }
        }
      } else {
        text += 'All executable lines are covered.\n';
      }
    } else {
      text += `Note: Could not retrieve line-level coverage from archive.\n`;
    }
  }

  return {
    content: [{ type: 'text', text: text.trimEnd() }],
    nextStepParams: {
      get_coverage_report: { xcresultPath },
    },
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
