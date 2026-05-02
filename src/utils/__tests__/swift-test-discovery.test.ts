import { describe, expect, it } from 'vitest';
import { createMockFileSystemExecutor } from '../../test-utils/mock-executors.ts';
import { discoverSwiftTestsInFiles } from '../swift-test-discovery.ts';

describe('discoverSwiftTestsInFiles', () => {
  it('discovers Swift Testing functions with multiline parameterized Test attributes', async () => {
    const filePath = '/tmp/CalculatorServiceTests.swift';
    const fileSystemExecutor = createMockFileSystemExecutor({
      readFile: async () => `
import Testing

struct CalculatorServiceTests {
  @Test(
    "evaluates decimal operations",
    arguments: [
      ("1 + 1", "2"),
      ("4 / 2", "2"),
    ]
  )
  func evaluatesDecimalOperations(expression: String, expected: String) async throws {}

  @Test(arguments: ["+", "-", "×"])
  func evaluatesOperators(symbol: String) async throws {}
}
`,
    });

    const files = await discoverSwiftTestsInFiles(
      'CalculatorAppFeatureTests',
      [filePath],
      fileSystemExecutor,
    );

    expect(files).toHaveLength(1);
    expect(files[0].tests).toMatchObject([
      {
        framework: 'swift-testing',
        targetName: 'CalculatorAppFeatureTests',
        typeName: 'CalculatorServiceTests',
        methodName: 'evaluatesDecimalOperations',
        displayName: 'CalculatorAppFeatureTests/CalculatorServiceTests/evaluatesDecimalOperations',
        parameterized: true,
      },
      {
        framework: 'swift-testing',
        targetName: 'CalculatorAppFeatureTests',
        typeName: 'CalculatorServiceTests',
        methodName: 'evaluatesOperators',
        displayName: 'CalculatorAppFeatureTests/CalculatorServiceTests/evaluatesOperators',
        parameterized: true,
      },
    ]);
  });
});
