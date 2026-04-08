import { describe, expect, it } from 'vitest';
import { createMockFileSystemExecutor } from '../../test-utils/mock-executors.ts';
import { formatTestPreflight, resolveTestPreflight } from '../test-preflight.ts';

describe('test-preflight', () => {
  it('discovers XCTest and Swift Testing cases from scheme and test plan', async () => {
    const files = new Map<string, string>([
      [
        '/repo/App.xcworkspace/contents.xcworkspacedata',
        `<?xml version="1.0" encoding="UTF-8"?>
<Workspace version = "1.0">
  <FileRef location = "container:App.xcodeproj"></FileRef>
</Workspace>`,
      ],
      [
        '/repo/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
        `<?xml version="1.0" encoding="UTF-8"?>
<Scheme>
  <TestAction buildConfiguration = "Debug">
    <TestPlans>
      <TestPlanReference reference = "container:App/App.xctestplan" default = "YES"></TestPlanReference>
    </TestPlans>
    <Testables>
      <TestableReference skipped = "NO">
        <BuildableReference BlueprintName = "AppTests" ReferencedContainer = "container:App.xcodeproj"></BuildableReference>
      </TestableReference>
    </Testables>
  </TestAction>
</Scheme>`,
      ],
      [
        '/repo/App/App.xctestplan',
        JSON.stringify({
          testTargets: [
            {
              target: {
                name: 'FeatureTests',
                containerPath: 'container:FeaturePackage',
              },
            },
          ],
        }),
      ],
      [
        '/repo/AppTests/AppTests.swift',
        `import XCTest
final class AppTests: XCTestCase {
  func testLaunch() {}
}`,
      ],
      [
        '/repo/FeaturePackage/Tests/FeatureTests/FeatureTests.swift',
        `import Testing
@Suite struct FeatureTests {
  @Test func testThing() {}
}`,
      ],
    ]);

    const knownDirs = new Set(['/repo/AppTests', '/repo/FeaturePackage/Tests/FeatureTests']);

    const fileSystem = createMockFileSystemExecutor({
      readFile: async (targetPath) => {
        const content = files.get(targetPath);
        if (content === undefined) {
          throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' });
        }
        return content;
      },
      readdir: async (targetPath) => {
        if (targetPath === '/repo/AppTests') {
          return ['AppTests.swift'];
        }
        if (targetPath === '/repo/FeaturePackage/Tests/FeatureTests') {
          return ['FeatureTests.swift'];
        }
        return [];
      },
      stat: async (targetPath) => {
        if (!files.has(targetPath) && !knownDirs.has(targetPath)) {
          throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' });
        }
        return {
          isDirectory: () => knownDirs.has(targetPath),
          mtimeMs: 0,
        };
      },
    });

    const result = await resolveTestPreflight(
      {
        workspacePath: '/repo/App.xcworkspace',
        scheme: 'App',
        configuration: 'Debug',
        destinationName: 'iPhone 17 Pro',
      },
      fileSystem,
    );

    expect(result?.totalTests).toBe(2);
    expect(formatTestPreflight(result!)).toContain('Resolved to 2 test(s):');
    expect(formatTestPreflight(result!)).toContain('AppTests/AppTests/testLaunch');
    expect(formatTestPreflight(result!)).toContain('FeatureTests/FeatureTests/testThing');
  });

  it('does not emit partial discovery warnings for intentionally targeted test runs', async () => {
    const files = new Map<string, string>([
      [
        '/repo/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
        `<?xml version="1.0" encoding="UTF-8"?>
<Scheme>
  <TestAction buildConfiguration = "Debug">
    <Testables>
      <TestableReference skipped = "NO">
        <BuildableReference BlueprintName = "AppTests" ReferencedContainer = "container:App.xcodeproj"></BuildableReference>
      </TestableReference>
      <TestableReference skipped = "NO">
        <BuildableReference BlueprintName = "FeatureTests" ReferencedContainer = "container:FeaturePackage"></BuildableReference>
      </TestableReference>
    </Testables>
  </TestAction>
</Scheme>`,
      ],
      [
        '/repo/AppTests/AppTests.swift',
        `import XCTest
final class AppTests: XCTestCase {
  func testLaunch() {}
}`,
      ],
      [
        '/repo/FeaturePackage/Tests/FeatureTests/FeatureTests.swift',
        `import Testing
@Suite struct FeatureTests {
  @Test func testThing() {}
}`,
      ],
    ]);

    const knownDirs = new Set(['/repo/AppTests', '/repo/FeaturePackage/Tests/FeatureTests']);

    const fileSystem = createMockFileSystemExecutor({
      readFile: async (targetPath) => {
        const content = files.get(targetPath);
        if (content === undefined) {
          throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' });
        }
        return content;
      },
      readdir: async (targetPath) => {
        if (targetPath === '/repo/AppTests') {
          return ['AppTests.swift'];
        }
        if (targetPath === '/repo/FeaturePackage/Tests/FeatureTests') {
          return ['FeatureTests.swift'];
        }
        return [];
      },
      stat: async (targetPath) => {
        if (!files.has(targetPath) && !knownDirs.has(targetPath)) {
          throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' });
        }
        return {
          isDirectory: () => knownDirs.has(targetPath),
          mtimeMs: 0,
        };
      },
    });

    const result = await resolveTestPreflight(
      {
        projectPath: '/repo/App.xcodeproj',
        scheme: 'App',
        configuration: 'Debug',
        destinationName: 'iPhone 17 Pro',
        extraArgs: ['-only-testing:AppTests'],
      },
      fileSystem,
    );

    expect(result?.totalTests).toBe(1);
    expect(result?.completeness).toBe('complete');
    expect(result?.warnings).toEqual([]);

    const output = formatTestPreflight(result!);
    expect(output).toContain('Resolved to 1 test(s):');
    expect(output).toContain('AppTests/AppTests/testLaunch');
    expect(output).not.toContain('Discovery completeness: partial');
    expect(output).not.toContain('Selectors filtered out all discovered tests');
    expect(output).not.toContain('FeatureTests/FeatureTests/testThing');
  });
});
