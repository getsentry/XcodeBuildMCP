/**
 * Tests for get_coverage_report tool
 * Covers happy-path, target filtering, showFiles, and failure paths
 */

import { afterEach, describe, it, expect } from 'vitest';
import { createMockExecutor, createMockFileSystemExecutor } from '../../../../test-utils/mock-executors.ts';
import {
  __setTestCommandExecutorOverride,
  __setTestFileSystemExecutorOverride,
  __clearTestExecutorOverrides,
} from '../../../../utils/execution/index.ts';
import { schema, handler, get_coverage_reportLogic } from '../get_coverage_report.ts';

const sampleTargets = [
  { name: 'MyApp.app', coveredLines: 100, executableLines: 200, lineCoverage: 0.5 },
  { name: 'Core', coveredLines: 50, executableLines: 500, lineCoverage: 0.1 },
  { name: 'MyAppTests.xctest', coveredLines: 30, executableLines: 30, lineCoverage: 1.0 },
];

const sampleTargetsWithFiles = [
  {
    name: 'MyApp.app',
    coveredLines: 100,
    executableLines: 200,
    lineCoverage: 0.5,
    files: [
      {
        name: 'AppDelegate.swift',
        path: '/src/AppDelegate.swift',
        coveredLines: 10,
        executableLines: 50,
        lineCoverage: 0.2,
      },
      {
        name: 'ViewModel.swift',
        path: '/src/ViewModel.swift',
        coveredLines: 90,
        executableLines: 150,
        lineCoverage: 0.6,
      },
    ],
  },
  {
    name: 'Core',
    coveredLines: 50,
    executableLines: 500,
    lineCoverage: 0.1,
    files: [
      {
        name: 'Service.swift',
        path: '/src/Service.swift',
        coveredLines: 0,
        executableLines: 300,
        lineCoverage: 0,
      },
      {
        name: 'Model.swift',
        path: '/src/Model.swift',
        coveredLines: 50,
        executableLines: 200,
        lineCoverage: 0.25,
      },
    ],
  },
];

const mockFileSystem = createMockFileSystemExecutor({ existsSync: () => true });

afterEach(() => {
  __clearTestExecutorOverrides();
});

describe('get_coverage_report', () => {
  describe('Export Validation', () => {
    it('should export get_coverage_reportLogic function', () => {
      expect(typeof get_coverage_reportLogic).toBe('function');
    });

    it('should export handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should export schema with expected keys', () => {
      expect(Object.keys(schema)).toContain('xcresultPath');
      expect(Object.keys(schema)).toContain('target');
      expect(Object.keys(schema)).toContain('showFiles');
    });
  });

  describe('Handler DI', () => {
    it('should use injected fileSystem from handler context', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: JSON.stringify(sampleTargets) });
      const missingFs = createMockFileSystemExecutor({ existsSync: () => false });

      __setTestCommandExecutorOverride(mockExecutor);
      __setTestFileSystemExecutorOverride(missingFs);

      const result = await handler({ xcresultPath: '/tmp/missing.xcresult', showFiles: false });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('File not found');
    });

    it('should use injected command executor on handler happy path', async () => {
      const commands: string[][] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
        onExecute: (command) => {
          commands.push(command);
        },
      });
      const existingFs = createMockFileSystemExecutor({ existsSync: () => true });

      __setTestCommandExecutorOverride(mockExecutor);
      __setTestFileSystemExecutorOverride(existingFs);

      const result = await handler({ xcresultPath: '/tmp/test.xcresult' });

      expect(result.isError).toBeUndefined();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain('--only-targets');
      expect(commands[0]).toContain('/tmp/test.xcresult');
    });
  });

  describe('Command Generation', () => {
    it('should use --only-targets when showFiles is false', async () => {
      const commands: string[][] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
        onExecute: (command) => {
          commands.push(command);
        },
      });

      await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain('--only-targets');
      expect(commands[0]).toContain('--json');
      expect(commands[0]).toContain('/tmp/test.xcresult');
    });

    it('should omit --only-targets when showFiles is true', async () => {
      const commands: string[][] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargetsWithFiles),
        onExecute: (command) => {
          commands.push(command);
        },
      });

      await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(commands).toHaveLength(1);
      expect(commands[0]).not.toContain('--only-targets');
    });
  });

  describe('Happy Path', () => {
    it('should return coverage report with all targets sorted by coverage', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('Code Coverage Report');
      expect(text).toContain('Overall: 24.7%');
      expect(text).toContain('180/730 lines');
      const coreIdx = text.indexOf('Core');
      const appIdx = text.indexOf('MyApp.app');
      const testIdx = text.indexOf('MyAppTests.xctest');
      expect(coreIdx).toBeLessThan(appIdx);
      expect(appIdx).toBeLessThan(testIdx);
    });

    it('should include nextStepParams with xcresultPath', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.nextStepParams).toEqual({
        get_file_coverage: { xcresultPath: '/tmp/test.xcresult' },
      });
    });

    it('should handle nested targets format', async () => {
      const nestedData = { targets: sampleTargets };
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(nestedData),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('Core: 10.0%');
      expect(text).toContain('MyApp.app: 50.0%');
    });
  });

  describe('Target Filtering', () => {
    it('should filter targets by substring match', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', target: 'MyApp', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('MyApp.app');
      expect(text).toContain('MyAppTests.xctest');
      expect(text).not.toMatch(/^\s+Core:/m);
    });

    it('should filter case-insensitively', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', target: 'core', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('Core: 10.0%');
    });

    it('should return error when no targets match filter', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargets),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', target: 'NonExistent', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('No targets found matching "NonExistent"');
    });
  });

  describe('showFiles', () => {
    it('should include per-file breakdown under each target', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargetsWithFiles),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('AppDelegate.swift: 20.0%');
      expect(text).toContain('ViewModel.swift: 60.0%');
      expect(text).toContain('Service.swift: 0.0%');
      expect(text).toContain('Model.swift: 25.0%');
    });

    it('should sort files by coverage ascending within each target', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify(sampleTargetsWithFiles),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: true },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      const appDelegateIdx = text.indexOf('AppDelegate.swift');
      const viewModelIdx = text.indexOf('ViewModel.swift');
      expect(appDelegateIdx).toBeLessThan(viewModelIdx);
    });
  });

  describe('Failure Paths', () => {
    it('should return error when xcresult path does not exist', async () => {
      const missingFs = createMockFileSystemExecutor({ existsSync: () => false });
      const mockExecutor = createMockExecutor({ success: true, output: '{}' });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/missing.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: missingFs },
      );

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('File not found');
      expect(text).toContain('/tmp/missing.xcresult');
    });

    it('should return error when xccov command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Failed to load result bundle',
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/bad.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('Failed to get coverage report');
      expect(text).toContain('Failed to load result bundle');
    });

    it('should return error when JSON parsing fails', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'not valid json',
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('Failed to parse coverage JSON output');
    });

    it('should return error when data format is unexpected', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({ unexpected: 'format' }),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('Unexpected coverage data format');
    });

    it('should return error when targets array is empty', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify([]),
      });

      const result = await get_coverage_reportLogic(
        { xcresultPath: '/tmp/test.xcresult', showFiles: false },
        { executor: mockExecutor, fileSystem: mockFileSystem },
      );

      expect(result.isError).toBe(true);
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(text).toContain('No coverage data found');
    });
  });
});
