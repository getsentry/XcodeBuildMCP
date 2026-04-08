import { dirname, resolve, sep } from 'node:path';
import { log } from './logger.ts';
import { parseXcuserstate } from './nskeyedarchiver-parser.ts';
import type { CommandExecutor } from './execution/index.ts';

export interface XcodeStateResult {
  scheme?: string;
  simulatorId?: string;
  simulatorName?: string;
  error?: string;
}

export interface XcodeStateReaderContext {
  executor: CommandExecutor;
  cwd: string;
  searchRoot?: string;
  workspacePath?: string;
  projectPath?: string;
}

function buildFindProjectsCommand(root: string, maxDepth: number): string[] {
  return [
    'find',
    root,
    '-maxdepth',
    String(maxDepth),
    '(',
    '-name',
    '*.xcworkspace',
    '-o',
    '-name',
    '*.xcodeproj',
    ')',
    '-type',
    'd',
  ];
}

function isPathWithinBoundary(path: string, boundary: string): boolean {
  return path === boundary || path.startsWith(`${boundary}${sep}`);
}

function listParentDirectories(startPath: string, boundaryPath: string): string[] {
  const parents: string[] = [];
  const start = resolve(startPath);
  const boundary = resolve(boundaryPath);

  if (!isPathWithinBoundary(start, boundary)) {
    return parents;
  }

  let current = start;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      break;
    }

    if (!isPathWithinBoundary(parent, boundary)) {
      break;
    }

    parents.push(parent);
    if (parent === boundary) {
      break;
    }

    current = parent;
  }

  return parents;
}

function collectFindPaths(output: string): string[] {
  return output
    .trim()
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
}

export async function findXcodeStateFile(
  ctx: XcodeStateReaderContext,
): Promise<string | undefined> {
  const { executor, cwd, searchRoot, workspacePath, projectPath } = ctx;

  const userResult = await executor(['whoami'], 'Get username', false);
  if (!userResult.success) {
    log('warn', `[xcode-state] Failed to get username: ${userResult.error}`);
    return undefined;
  }
  const username = userResult.output.trim();

  if (workspacePath || projectPath) {
    const basePath = workspacePath ?? projectPath;
    const xcuserstatePath = buildXcuserstatePath(basePath!, username);
    const testResult = await executor(
      ['test', '-f', xcuserstatePath],
      'Check xcuserstate exists',
      false,
    );
    if (testResult.success) {
      log('debug', `[xcode-state] Found xcuserstate from config: ${xcuserstatePath}`);
      return xcuserstatePath;
    }
    log('debug', `[xcode-state] Configured path xcuserstate not found: ${xcuserstatePath}`);
  }

  const discoveredPaths = new Set<string>();

  const descendantsResult = await executor(
    buildFindProjectsCommand(cwd, 6),
    'Find Xcode project/workspace in cwd descendants',
    false,
  );
  if (descendantsResult.success && descendantsResult.output.trim()) {
    for (const path of collectFindPaths(descendantsResult.output)) {
      discoveredPaths.add(path);
    }
  }

  const parentSearchBoundary = searchRoot ?? cwd;
  for (const parentDir of listParentDirectories(cwd, parentSearchBoundary)) {
    const parentResult = await executor(
      buildFindProjectsCommand(parentDir, 1),
      'Find Xcode project/workspace in parent directory',
      false,
    );
    if (!parentResult.success || !parentResult.output.trim()) {
      continue;
    }
    for (const path of collectFindPaths(parentResult.output)) {
      discoveredPaths.add(path);
    }
  }

  if (discoveredPaths.size === 0) {
    log(
      'debug',
      `[xcode-state] No Xcode project/workspace found in ${cwd} (boundary: ${parentSearchBoundary})`,
    );
    return undefined;
  }

  const paths = [...discoveredPaths];

  const filteredPaths = paths
    .filter((p) => !p.includes('.xcodeproj/project.xcworkspace'))
    .sort((a, b) => {
      const aIsWorkspace = a.endsWith('.xcworkspace');
      const bIsWorkspace = b.endsWith('.xcworkspace');
      if (aIsWorkspace && !bIsWorkspace) return -1;
      if (!aIsWorkspace && bIsWorkspace) return 1;
      return 0;
    });

  const candidates: Array<{ path: string; mtime: number }> = [];

  for (const projectPath of filteredPaths) {
    const xcuserstatePath = buildXcuserstatePath(projectPath, username);
    const statResult = await executor(
      ['stat', '-f', '%m', xcuserstatePath],
      'Get xcuserstate mtime',
      false,
    );

    if (statResult.success) {
      const mtime = parseInt(statResult.output.trim(), 10);
      candidates.push({ path: xcuserstatePath, mtime });
    }
  }

  if (candidates.length === 0) {
    log('debug', `[xcode-state] No xcuserstate file found for user ${username}`);
    return undefined;
  }

  if (candidates.length > 1) {
    candidates.sort((a, b) => b.mtime - a.mtime);
    log(
      'debug',
      `[xcode-state] Found ${candidates.length} xcuserstate files, using newest: ${candidates[0].path}`,
    );
  }

  log('debug', `[xcode-state] Found xcuserstate: ${candidates[0].path}`);
  return candidates[0].path;
}

function buildXcuserstatePath(projectPath: string, username: string): string {
  const base = projectPath.endsWith('.xcworkspace')
    ? projectPath
    : `${projectPath}/project.xcworkspace`;
  return `${base}/xcuserdata/${username}.xcuserdatad/UserInterfaceState.xcuserstate`;
}

export async function lookupSimulatorName(
  ctx: XcodeStateReaderContext,
  simulatorId: string,
): Promise<string | undefined> {
  const { executor } = ctx;

  const result = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
    'List simulators',
    false,
  );

  if (!result.success) {
    log('warn', `[xcode-state] Failed to list simulators: ${result.error}`);
    return undefined;
  }

  try {
    const data = JSON.parse(result.output) as {
      devices: Record<string, Array<{ udid: string; name: string }>>;
    };

    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.udid === simulatorId) {
          return device.name;
        }
      }
    }
  } catch (e) {
    log('warn', `[xcode-state] Failed to parse simulator list: ${e}`);
  }

  return undefined;
}

export async function readXcodeIdeState(ctx: XcodeStateReaderContext): Promise<XcodeStateResult> {
  try {
    const xcuserstatePath = await findXcodeStateFile(ctx);
    if (!xcuserstatePath) {
      return { error: 'No Xcode project/workspace found in working directory' };
    }

    const state = parseXcuserstate(xcuserstatePath);

    const result: XcodeStateResult = {};

    if (state.scheme) {
      result.scheme = state.scheme;
      log('info', `[xcode-state] Detected active scheme: ${state.scheme}`);
    }

    if (state.simulatorId) {
      result.simulatorId = state.simulatorId;

      const name = await lookupSimulatorName(ctx, state.simulatorId);
      if (name) {
        result.simulatorName = name;
        log('info', `[xcode-state] Detected active simulator: ${name} (${state.simulatorId})`);
      } else {
        log('info', `[xcode-state] Detected active destination: ${state.simulatorId}`);
      }
    }

    if (!result.scheme && !result.simulatorId) {
      return { error: 'Could not extract active scheme or destination from Xcode state' };
    }

    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log('warn', `[xcode-state] Failed to read Xcode IDE state: ${message}`);
    return { error: message };
  }
}
