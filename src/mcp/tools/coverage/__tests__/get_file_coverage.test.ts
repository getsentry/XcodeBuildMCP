import { afterEach, describe, it, expect } from 'vitest';
import {
  createMockExecutor,
  createMockCommandResponse,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import {
  __setTestCommandExecutorOverride,
  __setTestFileSystemExecutorOverride,
  __clearTestExecutorOverrides,
} from '../../../../utils/execution/index.ts';
import { schema, handler, get_file_coverageLogic } from '../get_file_coverage.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';



const sampleFunctionsJson = [
  {
    file: '/src/MyApp/ViewModel.swift',
    functions: [
      {
        name: 'init()',
        coveredLines: 5,
        executableLines: 5,
        executionCount: 3,
        lineCoverage: 1.0,
        lineNumber: 10,
      },
      {
        name: 'loadData()',
        coveredLines: 8,
        executableLines: 12,
        executionCount: 2,
        lineCoverage: 0.667,
        lineNumber: 20,
      },
      {
        name: 'reset()',
        coveredLines: 0,
        executableLines: 4,
        executionCount: 0,
        lineCoverage: 0,
        lineNumber: 40,
      },
    ],
  },
];

const sampleArchiveOutput = [
  '    1: *',
  '    2: 1',
  '    3: 1',
  '    4: 0',
  '    5: 0',
  '    6: 0',
  '    7: 1',
  '    8: *',
  '    9: 0',
  '   10: 1',
].join('\n');

const mockFileSystem = createMockFileSystemExecutor({ existsSync: () => true });

afterEach(() => {
  __clearTestExecutorOverrides();
});

describe('get_file_coverage', () => {
  describe('Export Validation', () => {
    it('should export get_file_coverageLogic function', () => {
      expect(typeof get_file_coverageLogic).toBe('function');
    });

    it('should export handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should export schema with expected keys', () => {
      expect(Object.keys(schema)).toContain('xcresultPath');
      expect(Object.keys(schema)).toContain('file');
      expect(Object.keys(schema)).toContain('showLines');
    });
  });

  describe('Handler DI', () => {
    it('should use injected fileSystem from handler context', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
      });
      const missingFs = createMockFileSystemExecutor({ existsSync: () => false });

      __setTestCommandExecutorOverride(mockExecutor);
      __setTestFileSystemExecutorOverride(missingFs);

      const result = await handler({
        xcresultPath: '/tmp/missing.xcresult',
        file: 'ViewModel.swift',
        showLines: false,
      });

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('File not found');
    });

    it('should use injected command executor on handler happy path', async () => {
      const commands: string[][] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
        onExecute: (command) => {
          commands.push(command);
        },
      });
      const existingFs = createMockFileSystemExecutor({ existsSync: () => true });

      __setTestCommandExecutorOverride(mockExecutor);
      __setTestFileSystemExecutorOverride(existingFs);

      const result = await handler({ xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift' });

      expect(result.isError).toBeUndefined();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain('--functions-for-file');
      expect(commands[0]).toContain('/tmp/test.xcresult');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct functions-for-file command', async () => {
      const commands: string[][] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
        onExecute: (command) => {
          commands.push(command);
        },
      });

      await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual([
        'xcrun',
        'xccov',
        'view',
        '--report',
        '--functions-for-file',
        'ViewModel.swift',
        '--json',
        '/tmp/test.xcresult',
      ]);
    });

    it('should issue archive command when showLines is true', async () => {
      const commands: string[][] = [];
      let callCount = 0;
      const mockExecutor = async (
        command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        commands.push(command);
        callCount++;
        if (callCount === 1) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify(sampleFunctionsJson),
            exitCode: 0,
          });
        }
        return createMockCommandResponse({ success: true, output: sampleArchiveOutput, exitCode: 0 });
      };

      await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual([
        'xcrun',
        'xccov',
        'view',
        '--archive',
        '--file',
        '/src/MyApp/ViewModel.swift',
        '/tmp/test.xcresult',
      ]);
    });
  });

  describe('Happy Path', () => {
    it('should return function-level coverage with file summary', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('File: /src/MyApp/ViewModel.swift');
      expect(text).toContain('Coverage: 61.9%');
      expect(text).toContain('13/21 lines');
    });

    it('should group uncovered functions under Not Covered section', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      const text = allText(result);
      expect(text).toContain('Not Covered (1 function, 4 lines)');
      expect(text).toContain('L40  reset()');
    });

    it('should group functions by coverage status', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      const text = allText(result);
      const notCoveredIdx = text.indexOf('Not Covered');
      const partialIdx = text.indexOf('Partial Coverage');
      const fullIdx = text.indexOf('Full Coverage');
      expect(notCoveredIdx).toBeLessThan(partialIdx);
      expect(partialIdx).toBeLessThan(fullIdx);
    });

    it('should show partial coverage functions with percentage', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      const text = allText(result);
      expect(text).toContain('Partial Coverage (1 function)');
      expect(text).toContain('L20  loadData()');
      expect(text).toContain('66.7%');
    });

    it('should include nextStepParams', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleFunctionsJson),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.nextStepParams).toEqual({
        get_coverage_report: { xcresultPath: '/tmp/test.xcresult' },
      });
    });
  });

  describe('Nested targets format', () => {
    it('should handle { targets: [{ files: [...] }] } format', async () => {
      const nestedData = {
        targets: [
          {
            files: [
              {
                path: '/src/Model.swift',
                name: 'Model.swift',
                coveredLines: 10,
                executableLines: 20,
                lineCoverage: 0.5,
                functions: [
                  {
                    name: 'save()',
                    coveredLines: 10,
                    executableLines: 20,
                    executionCount: 5,
                    lineCoverage: 0.5,
                    lineNumber: 1,
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(nestedData),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'Model.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('File: /src/Model.swift');
      expect(text).toContain('50.0%');
    });
  });

  describe('showLines', () => {
    it('should include uncovered line ranges from archive output', async () => {
      let callCount = 0;
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        if (callCount === 1) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify(sampleFunctionsJson),
            exitCode: 0,
          });
        }
        return createMockCommandResponse({ success: true, output: sampleArchiveOutput, exitCode: 0 });
      };

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      const text = allText(result);
      expect(text).toContain('Uncovered line ranges (/src/MyApp/ViewModel.swift)');
      expect(text).toContain('L4-6');
      expect(text).toContain('L9');
    });

    it('should show "All executable lines are covered" when no uncovered lines', async () => {
      const allCoveredArchive = '    1: *\n    2: 1\n    3: 1\n    4: 1\n';
      let callCount = 0;
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        if (callCount === 1) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify(sampleFunctionsJson),
            exitCode: 0,
          });
        }
        return createMockCommandResponse({ success: true, output: allCoveredArchive, exitCode: 0 });
      };

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      const text = allText(result);
      expect(text).toContain('All executable lines are covered');
    });

    it('should handle archive command failure gracefully', async () => {
      let callCount = 0;
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        if (callCount === 1) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify(sampleFunctionsJson),
            exitCode: 0,
          });
        }
        return createMockCommandResponse({
          success: false,
          output: '',
          error: 'archive error',
          exitCode: 1,
        });
      };

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'ViewModel.swift', showLines: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Could not retrieve line-level coverage from archive');
    });
  });

  describe('Failure Paths', () => {
    it('should return error when xcresult path does not exist', async () => {
      const missingFs = createMockFileSystemExecutor({ existsSync: () => false });
      const mockExecutor = createMockExecutor({ success: true, output: '{}' });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/missing.xcresult', file: 'Foo.swift', showLines: false },
        { executor: mockExecutor, fileSystem: missingFs },
      ));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('File not found');
      expect(text).toContain('/tmp/missing.xcresult');
    });

    it('should return error when functions-for-file command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Failed to load result bundle',
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/bad.xcresult', file: 'Foo.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to get file coverage');
      expect(text).toContain('Failed to load result bundle');
    });

    it('should return error when JSON parsing fails', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'not json',
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'Foo.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to parse coverage JSON output');
    });

    it('should return error when no file entries found', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify([]),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'Missing.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('No coverage data found for "Missing.swift"');
    });

    it('should return no data when targets field is not an array', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({ targets: 'not-an-array' }),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'Foo.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('No coverage data found for "Foo.swift"');
    });

    it('should handle file entry with no functions gracefully', async () => {
      const noFunctions = [{ file: '/src/Empty.swift', functions: [] }];
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(noFunctions),
      });

      const result = await runLogic(() => get_file_coverageLogic(
        { xcresultPath: '/tmp/test.xcresult', file: 'Empty.swift', showLines: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      ));

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('File: /src/Empty.swift');
      expect(text).toContain('Coverage: 0.0%');
      expect(text).toContain('0/0 lines');
    });
  });
});
