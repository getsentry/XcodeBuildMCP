import { execFileSync } from 'node:child_process';
import { log } from './logger.ts';
import type { TestFailureFragment } from '../types/domain-fragments.ts';
import type { Counts } from '../types/domain-results.ts';
import { parseRawTestName } from './xcodebuild-line-parsers.ts';

interface XcresultTestNode {
  name: string;
  nodeType: string;
  result?: string;
  children?: XcresultTestNode[];
}

interface XcresultTestResults {
  testNodes: XcresultTestNode[];
}

interface XcresultTestSummary {
  totalTestCount?: unknown;
  passedTests?: unknown;
  failedTests?: unknown;
  skippedTests?: unknown;
}

function isSummaryCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseXcresultTestSummaryCounts(raw: string): Counts | null {
  let summary: XcresultTestSummary;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    summary = parsed as XcresultTestSummary;
  } catch {
    return null;
  }

  const { passedTests, failedTests, skippedTests } = summary;

  if (
    !isSummaryCount(passedTests) ||
    !isSummaryCount(failedTests) ||
    !isSummaryCount(skippedTests)
  ) {
    return null;
  }

  return {
    passed: passedTests,
    failed: failedTests,
    skipped: skippedTests,
  };
}

export function extractTestSummaryCountsFromXcresult(xcresultPath: string): Counts | null {
  try {
    const output = execFileSync(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'summary', '--path', xcresultPath, '--compact'],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    return parseXcresultTestSummaryCounts(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('debug', `Failed to extract test summary from xcresult: ${message}`);
    return null;
  }
}

export function extractTestFailuresFromXcresult(xcresultPath: string): TestFailureFragment[] {
  try {
    const output = execFileSync(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', xcresultPath],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const results = JSON.parse(output) as XcresultTestResults;
    const fragments: TestFailureFragment[] = [];

    function walk(node: XcresultTestNode, suiteContext?: string): void {
      const parsedNodeName = parseRawTestName(node.name);
      const nextSuiteContext =
        node.nodeType === 'Test Case'
          ? suiteContext
          : (parsedNodeName.suiteName ??
            (node.nodeType === 'Test Suite' ? node.name.replaceAll('_', ' ') : suiteContext));

      if (node.nodeType === 'Test Case' && node.result === 'Failed' && node.children) {
        for (const child of node.children) {
          if (child.nodeType === 'Failure Message') {
            const parsed = parseXcresultFailureMessage(child.name);
            const { suiteName, testName } = parsedNodeName;
            fragments.push({
              kind: 'test-result',
              fragment: 'test-failure',
              operation: 'TEST',
              suite: suiteName ?? suiteContext,
              test: testName,
              message: parsed.message,
              location: parsed.location,
            });
          }
        }
      }
      if (node.children) {
        for (const child of node.children) {
          walk(child, nextSuiteContext);
        }
      }
    }

    for (const root of results.testNodes) {
      walk(root);
    }

    return fragments;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('debug', `Failed to extract test failures from xcresult: ${message}`);
    return [];
  }
}

export function parseXcresultFailureMessage(raw: string): { message: string; location?: string } {
  const [firstLine = '', ...continuationLines] = raw.split(/\r?\n/u);
  const match = firstLine.match(/^(.+?):(\d+):\s*(.*)$/u);
  if (match) {
    const message = [match[3], ...continuationLines]
      .join('\n')
      .replace(/^failed\s*-\s*/u, '')
      .replace(/:\s+(?=\/\/)/u, '\n');
    return {
      location: match[2] === '0' ? undefined : `${match[1]}:${match[2]}`,
      message,
    };
  }
  return { message: raw };
}
