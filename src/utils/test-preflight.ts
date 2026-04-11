import path from 'node:path';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';
import {
  discoverSwiftTestsInFiles,
  type DiscoveredTestCase,
  type DiscoveredTestFile,
} from './swift-test-discovery.ts';

export interface TestSelector {
  raw: string;
  target: string;
  classOrSuite?: string;
  method?: string;
}

export interface ResolvedTestTarget {
  name: string;
  files: DiscoveredTestFile[];
  warnings: string[];
}

export interface TestPreflightResult {
  scheme: string;
  configuration: string;
  workspacePath?: string;
  projectPath?: string;
  destinationName: string;
  selectors: {
    onlyTesting: TestSelector[];
    skipTesting: TestSelector[];
  };
  targets: ResolvedTestTarget[];
  warnings: string[];
  totalTests: number;
  completeness: 'complete' | 'partial' | 'unresolved';
}

interface ReferencedTestTarget {
  name: string;
  containerPath?: string;
}

function normalizeSelectorMethodName(method: string | undefined): string | undefined {
  if (!method) {
    return undefined;
  }

  return method.replace(/\(\)$/, '');
}

function parseSelector(raw: string): TestSelector | null {
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  return {
    raw,
    target: parts[0],
    classOrSuite: parts[1],
    method: normalizeSelectorMethodName(parts[2]),
  };
}

function parseSelectors(
  extraArgs: string[] | undefined,
  flagName: '-only-testing' | '-skip-testing',
): TestSelector[] {
  if (!extraArgs) {
    return [];
  }

  const selectors: TestSelector[] = [];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index];
    if (argument === flagName) {
      const nextValue = extraArgs[index + 1];
      if (nextValue) {
        const selector = parseSelector(nextValue);
        if (selector) {
          selectors.push(selector);
        }
        index += 1;
      }
      continue;
    }

    if (argument.startsWith(`${flagName}:`)) {
      const selector = parseSelector(argument.slice(flagName.length + 1));
      if (selector) {
        selectors.push(selector);
      }
    }
  }

  return selectors;
}

function extractAttributeValue(tagBody: string, attributeName: string): string | undefined {
  const match = tagBody.match(new RegExp(`${attributeName}\\s*=\\s*"([^"]+)"`));
  return match?.[1];
}

function resolveContainerReference(reference: string, baseDir: string): string {
  if (reference.startsWith('container:')) {
    return path.resolve(baseDir, reference.slice('container:'.length));
  }
  if (reference.startsWith('group:')) {
    return path.resolve(baseDir, reference.slice('group:'.length));
  }
  if (reference.startsWith('absolute:')) {
    return reference.slice('absolute:'.length);
  }
  return path.resolve(baseDir, reference);
}

async function findSchemePath(
  params: { workspacePath?: string; projectPath?: string; scheme: string },
  fileSystemExecutor: FileSystemExecutor,
): Promise<string | null> {
  const candidates: string[] = [];

  if (params.projectPath) {
    candidates.push(
      path.join(params.projectPath, 'xcshareddata', 'xcschemes', `${params.scheme}.xcscheme`),
    );
  }

  if (params.workspacePath) {
    candidates.push(
      path.join(params.workspacePath, 'xcshareddata', 'xcschemes', `${params.scheme}.xcscheme`),
    );

    const workspaceDir = path.dirname(params.workspacePath);
    const workspaceDataPath = path.join(params.workspacePath, 'contents.xcworkspacedata');
    try {
      const workspaceData = await fileSystemExecutor.readFile(workspaceDataPath, 'utf8');
      const matches = [...workspaceData.matchAll(/<FileRef\s+location\s*=\s*"([^"]+)"/g)];
      for (const match of matches) {
        const resolved = resolveContainerReference(match[1], workspaceDir);
        if (resolved.endsWith('.xcodeproj')) {
          candidates.push(
            path.join(resolved, 'xcshareddata', 'xcschemes', `${params.scheme}.xcscheme`),
          );
        }
      }
    } catch {
      // workspace data file not found; skip
    }
  }

  for (const candidate of candidates) {
    try {
      await fileSystemExecutor.stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function parseSchemeTargets(schemeContent: string): ReferencedTestTarget[] {
  const targets: ReferencedTestTarget[] = [];
  const testableMatches = [
    ...schemeContent.matchAll(/<TestableReference([\s\S]*?)<\/TestableReference>/g),
  ];
  for (const match of testableMatches) {
    const block = match[1];
    if (extractAttributeValue(block, 'skipped') === 'YES') {
      continue;
    }

    const blueprintName = extractAttributeValue(block, 'BlueprintName');
    if (!blueprintName) {
      continue;
    }

    targets.push({
      name: blueprintName,
      containerPath: extractAttributeValue(block, 'ReferencedContainer'),
    });
  }

  return targets;
}

async function parseTestPlanTargets(
  schemeContent: string,
  baseDir: string,
  fileSystemExecutor: FileSystemExecutor,
): Promise<ReferencedTestTarget[]> {
  const targets: ReferencedTestTarget[] = [];
  const matches = [...schemeContent.matchAll(/<TestPlanReference\s+reference\s*=\s*"([^"]+)"/g)];

  for (const match of matches) {
    const planPath = resolveContainerReference(match[1], baseDir);
    let planContent: string;
    try {
      planContent = await fileSystemExecutor.readFile(planPath, 'utf8');
    } catch {
      continue;
    }
    const planJson = JSON.parse(planContent) as {
      testTargets?: Array<{ target?: { name?: string; containerPath?: string } }>;
    };

    for (const testTarget of planJson.testTargets ?? []) {
      const target = testTarget.target;
      if (!target?.name) {
        continue;
      }
      targets.push({
        name: target.name,
        containerPath: target.containerPath,
      });
    }
  }

  return targets;
}

async function listDirectoryEntries(
  directoryPath: string,
  fileSystemExecutor: FileSystemExecutor,
): Promise<string[]> {
  try {
    const entries = await fileSystemExecutor.readdir(directoryPath);
    return entries.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

async function collectSwiftFiles(
  directoryPath: string,
  fileSystemExecutor: FileSystemExecutor,
): Promise<string[]> {
  const entries = await listDirectoryEntries(directoryPath, fileSystemExecutor);
  if (entries.length === 0) {
    return [];
  }

  const entryPaths = entries.map((entry) => path.join(directoryPath, entry));
  const statResults = await Promise.all(
    entryPaths.map(async (fullPath) => {
      try {
        const stats = await fileSystemExecutor.stat(fullPath);
        return { fullPath, isDir: stats.isDirectory() };
      } catch {
        return null;
      }
    }),
  );

  const files: string[] = [];
  const subdirPromises: Array<Promise<string[]>> = [];

  for (const result of statResults) {
    if (!result) {
      continue;
    }
    if (result.isDir) {
      subdirPromises.push(collectSwiftFiles(result.fullPath, fileSystemExecutor));
    } else if (result.fullPath.endsWith('.swift')) {
      files.push(result.fullPath);
    }
  }

  const nestedFiles = await Promise.all(subdirPromises);
  return files.concat(...nestedFiles);
}

async function resolveCandidateDirectories(
  reference: ReferencedTestTarget,
  params: { workspacePath?: string; projectPath?: string },
  fileSystemExecutor: FileSystemExecutor,
): Promise<string[]> {
  const roots = new Set<string>();
  const workspacePath = params.workspacePath ? path.resolve(params.workspacePath) : undefined;
  const projectPath = params.projectPath ? path.resolve(params.projectPath) : undefined;

  if (reference.containerPath) {
    const baseDir = path.dirname(workspacePath ?? projectPath ?? process.cwd());
    const resolvedContainer = resolveContainerReference(reference.containerPath, baseDir);

    if (resolvedContainer.endsWith('.xcodeproj')) {
      const containerDir = path.dirname(resolvedContainer);
      roots.add(path.join(containerDir, reference.name));
      roots.add(path.join(containerDir, 'Tests', reference.name));
    } else {
      roots.add(path.join(resolvedContainer, 'Tests', reference.name));
      roots.add(path.join(resolvedContainer, reference.name));
    }
  }

  if (workspacePath) {
    const workspaceDir = path.dirname(workspacePath);
    roots.add(path.join(workspaceDir, reference.name));
    roots.add(path.join(workspaceDir, 'Tests', reference.name));
  }

  if (projectPath) {
    const projectDir = path.dirname(projectPath);
    roots.add(path.join(projectDir, reference.name));
    roots.add(path.join(projectDir, 'Tests', reference.name));
  }

  const results = await Promise.all(
    [...roots].map(async (candidate) => {
      try {
        await fileSystemExecutor.stat(candidate);
        return candidate;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((candidate): candidate is string => candidate !== null);
}

function selectorMatches(test: DiscoveredTestCase, selector: TestSelector): boolean {
  return (
    selector.target === test.targetName &&
    (!selector.classOrSuite || selector.classOrSuite === test.typeName) &&
    (!selector.method || selector.method === test.methodName)
  );
}

function applySelectors(
  files: DiscoveredTestFile[],
  selectors: { onlyTesting: TestSelector[]; skipTesting: TestSelector[] },
): DiscoveredTestFile[] {
  return files
    .map((file) => {
      let tests = file.tests;
      if (selectors.onlyTesting.length > 0) {
        tests = tests.filter((test) =>
          selectors.onlyTesting.some((selector) => selectorMatches(test, selector)),
        );
      }
      if (selectors.skipTesting.length > 0) {
        tests = tests.filter(
          (test) => !selectors.skipTesting.some((selector) => selectorMatches(test, selector)),
        );
      }
      return {
        ...file,
        tests,
      };
    })
    .filter((file) => file.tests.length > 0);
}

export async function resolveTestPreflight(
  params: {
    workspacePath?: string;
    projectPath?: string;
    scheme: string;
    configuration: string;
    extraArgs?: string[];
    destinationName: string;
  },
  fileSystemExecutor: FileSystemExecutor,
): Promise<TestPreflightResult | null> {
  const selectors = {
    onlyTesting: parseSelectors(params.extraArgs, '-only-testing'),
    skipTesting: parseSelectors(params.extraArgs, '-skip-testing'),
  };

  const warnings: string[] = [];
  const schemePath = await findSchemePath(params, fileSystemExecutor);
  if (!schemePath) {
    warnings.push(`Could not find shared scheme file for ${params.scheme}.`);
    return {
      scheme: params.scheme,
      configuration: params.configuration,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      destinationName: params.destinationName,
      selectors,
      targets: [],
      warnings,
      totalTests: 0,
      completeness: 'unresolved',
    };
  }

  const schemeContent = await fileSystemExecutor.readFile(schemePath, 'utf8');
  const baseDir = path.dirname(params.workspacePath ?? params.projectPath ?? schemePath);
  const referencedTargets = new Map<string, ReferencedTestTarget>();

  for (const target of parseSchemeTargets(schemeContent)) {
    referencedTargets.set(target.name, target);
  }
  for (const target of await parseTestPlanTargets(schemeContent, baseDir, fileSystemExecutor)) {
    referencedTargets.set(target.name, target);
  }

  const targets: ResolvedTestTarget[] = [];

  for (const reference of referencedTargets.values()) {
    const candidateDirectories = await resolveCandidateDirectories(
      reference,
      params,
      fileSystemExecutor,
    );
    const swiftFiles = (
      await Promise.all(
        candidateDirectories.map((directoryPath) =>
          collectSwiftFiles(directoryPath, fileSystemExecutor),
        ),
      )
    ).flat();

    if (swiftFiles.length === 0) {
      const warning = `Could not resolve Swift source files for test target ${reference.name}.`;
      warnings.push(warning);
      targets.push({
        name: reference.name,
        files: [],
        warnings: [warning],
      });
      continue;
    }

    const discoveredFiles = await discoverSwiftTestsInFiles(
      reference.name,
      [...new Set(swiftFiles)],
      fileSystemExecutor,
    );
    const filteredFiles = applySelectors(discoveredFiles, selectors);

    if (
      filteredFiles.length === 0 &&
      (selectors.onlyTesting.length > 0 || selectors.skipTesting.length > 0)
    ) {
      continue;
    }

    if (discoveredFiles.length === 0) {
      const warning = `Found source files for ${reference.name}, but could not statically discover concrete tests.`;
      warnings.push(warning);
      targets.push({
        name: reference.name,
        files: [],
        warnings: [warning],
      });
      continue;
    }

    targets.push({
      name: reference.name,
      files: filteredFiles,
      warnings: [],
    });
  }

  const totalTests = targets.reduce(
    (sum, target) => sum + target.files.reduce((fileSum, file) => fileSum + file.tests.length, 0),
    0,
  );
  const unresolvedTargets = targets.filter((target) => target.files.length === 0).length;
  let completeness: 'complete' | 'partial' | 'unresolved';
  if (totalTests === 0) {
    completeness = 'unresolved';
  } else if (unresolvedTargets > 0 || warnings.length > 0) {
    completeness = 'partial';
  } else {
    completeness = 'complete';
  }

  return {
    scheme: params.scheme,
    configuration: params.configuration,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    destinationName: params.destinationName,
    selectors,
    targets,
    warnings,
    totalTests,
    completeness,
  };
}

export function collectResolvedTestSelectors(preflight: TestPreflightResult): string[] {
  return preflight.targets
    .flatMap((target) => target.files.flatMap((file) => file.tests.map((test) => test.displayName)))
    .sort();
}

export function formatTestSelectionSummary(preflight: TestPreflightResult): string | undefined {
  if (
    preflight.selectors.onlyTesting.length === 0 &&
    preflight.selectors.skipTesting.length === 0
  ) {
    return undefined;
  }

  const lines = [
    '   Selective Testing:',
    ...preflight.selectors.onlyTesting.map((selector) => `     ${selector.raw}`),
    ...preflight.selectors.skipTesting.map((selector) => `     Skip Testing: ${selector.raw}`),
  ];

  return lines.join('\n');
}

export function formatTestDiscovery(
  preflight: TestPreflightResult,
  options: { maxListedTests?: number } = {},
): string {
  const maxListedTests = options.maxListedTests ?? 5;
  const discoveredTests = collectResolvedTestSelectors(preflight);

  const listedTests = discoveredTests.slice(0, maxListedTests);
  const remainingCount = Math.max(discoveredTests.length - listedTests.length, 0);
  const lines = [
    `Resolved to ${preflight.totalTests} test(s):`,
    ...listedTests.map((test) => ` - ${test}`),
  ];

  if (remainingCount > 0) {
    lines.push(` ... and ${remainingCount} more`);
  }

  if (preflight.completeness !== 'complete') {
    lines.push(`Discovery completeness: ${preflight.completeness}`);
  }

  for (const warning of preflight.warnings) {
    lines.push(`Warning: ${warning}`);
  }

  return lines.join('\n');
}

/**
 * @deprecated Use formatToolPreflight + formatTestDiscovery instead.
 * Retained for backward compatibility with existing tests.
 */
export function formatTestPreflight(
  preflight: TestPreflightResult,
  options: { maxListedTests?: number } = {},
): string {
  return formatTestDiscovery(preflight, options);
}
