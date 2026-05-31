import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  isCliSnapshotRuntime,
  type SnapshotResult,
  type SnapshotRuntime,
  type WorkflowSnapshotHarness,
} from '../contracts.ts';
import { getSnapshotHarnessEnv } from '../harness.ts';
import { isXcodeIdeBridgeAvailable } from '../xcode-ide-availability.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const XCODE_IDE_BRIDGE_READY = isXcodeIdeBridgeAvailable();
const DOCUMENTATION_SEARCH_TOOL = 'DocumentationSearch';
const DOCUMENTATION_SEARCH_QUERY = 'AVCapturePhotoOutputMaxPhotoQualityPrioritization';
const CLI_PATH = join(process.cwd(), 'build/cli.js');
const XCODE_IDE_BRIDGE_SETTLE_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getArtifactPathFromEnvelope(result: SnapshotResult): string | null {
  const data = result.structuredEnvelope?.data;
  if (!isRecord(data) || !isRecord(data.artifacts)) {
    return null;
  }

  return typeof data.artifacts.rawResponseJsonPath === 'string'
    ? data.artifacts.rawResponseJsonPath
    : null;
}

function getArtifactPathFromText(result: SnapshotResult): string | null {
  const flatMatch = result.rawText.match(/Raw Response JSON:\s*(.+)$/m);
  if (flatMatch?.[1]) {
    return flatMatch[1].trim();
  }

  const treeMatch = result.rawText.match(/^\s*[├└]──\s*(.+?)\s+—\s+Raw Response JSON$/m);
  return treeMatch?.[1]?.trim() ?? null;
}

function resolveArtifactPath(artifactDisplayPath: string): string {
  if (artifactDisplayPath === '~') {
    return homedir();
  }
  if (artifactDisplayPath.startsWith('~/')) {
    return join(homedir(), artifactDisplayPath.slice(2));
  }
  if (isAbsolute(artifactDisplayPath)) {
    return artifactDisplayPath;
  }
  return join(process.cwd(), artifactDisplayPath);
}

function bridgeListContainsTool(result: SnapshotResult, toolName: string): boolean {
  const artifactDisplayPath =
    getArtifactPathFromEnvelope(result) ?? getArtifactPathFromText(result);
  if (!artifactDisplayPath) {
    throw new Error('xcode-ide list-tools warm-up did not expose a raw response artifact path.');
  }

  const artifactPath = resolveArtifactPath(artifactDisplayPath);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as unknown;
  if (
    !isRecord(artifact) ||
    !isRecord(artifact.response) ||
    !Array.isArray(artifact.response.tools)
  ) {
    throw new Error(
      `xcode-ide list-tools artifact did not contain response.tools: ${artifactPath}`,
    );
  }

  return artifact.response.tools.some((tool) => isRecord(tool) && tool.name === toolName);
}

if (!XCODE_IDE_BRIDGE_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[xcode-ide-suite] xcrun mcpbridge or a running Xcode instance is unavailable. Xcode IDE bridge snapshot tests will be skipped.',
  );
}

export function registerXcodeIdeSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'xcode-ide');

  describe.runIf(XCODE_IDE_BRIDGE_READY)(`${runtime} xcode-ide workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let tempDir: string;
    let socketPath: string;
    let daemonEnv: Record<string, string>;
    let bridgeListReady = false;
    let documentationSearchReady = false;

    beforeAll(async () => {
      if (isCliSnapshotRuntime(runtime)) {
        tempDir = mkdtempSync(join(tmpdir(), 'xcodebuildmcp-xcode-ide-snapshot-'));
        socketPath = join(tempDir, 'daemon.sock');
        daemonEnv = {
          XCODEBUILDMCP_ENABLED_WORKFLOWS: 'xcode-ide',
          XCODEBUILDMCP_DISABLE_SESSION_DEFAULTS: 'true',
          XCODEBUILDMCP_DISABLE_XCODE_AUTO_SYNC: '1',
          XCODEBUILDMCP_XCODE_IDE_DISCOVERY_TIMEOUT_MS: '5000',
        };
        harness = await createHarnessForRuntime(runtime, {
          env: daemonEnv,
          globalArgs: ['--socket', socketPath],
        });
      } else {
        harness = await createHarnessForRuntime(runtime, {
          enabledWorkflows: ['xcode-ide'],
        });
      }

      const warmup = await harness.invoke('xcode-ide', 'list-tools', { refresh: true });

      bridgeListReady = warmup.isError === false;
      documentationSearchReady =
        bridgeListReady && bridgeListContainsTool(warmup, DOCUMENTATION_SEARCH_TOOL);

      if (!bridgeListReady) {
        // eslint-disable-next-line no-console
        console.warn('[xcode-ide-suite] bridge warm-up failed; skipping xcode-ide snapshots.');
      } else {
        if (!documentationSearchReady) {
          // eslint-disable-next-line no-console
          console.warn(
            `[xcode-ide-suite] bridge warm-up did not expose ${DOCUMENTATION_SEARCH_TOOL}; skipping documentation-search snapshot only.`,
          );
        }
        await delay(XCODE_IDE_BRIDGE_SETTLE_MS);
      }
    });

    afterAll(async () => {
      await harness.cleanup();
      if (isCliSnapshotRuntime(runtime)) {
        try {
          execFileSync('node', [CLI_PATH, '--socket', socketPath, 'daemon', 'stop'], {
            env: getSnapshotHarnessEnv(daemonEnv),
            stdio: ['ignore', 'ignore', 'ignore'],
          });
        } catch {
          // best effort cleanup
        }
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    describe('list-tools', () => {
      it('success', async (context) => {
        if (!bridgeListReady) {
          context.skip();
        }

        const { text } = await harness.invoke('xcode-ide', 'list-tools', {
          refresh: false,
        });

        expectFixture(text, 'list-tools--success');
      }, 120_000);
    });

    describe('documentation-search', () => {
      it('success', async (context) => {
        if (!documentationSearchReady) {
          context.skip();
        }

        const { text } = await harness.invoke('xcode-ide', 'call-tool', {
          remoteTool: DOCUMENTATION_SEARCH_TOOL,
          arguments: { query: DOCUMENTATION_SEARCH_QUERY, frameworks: ['AVFoundation'] },
          timeoutMs: 120_000,
        });

        expectFixture(text, 'documentation-search--success');
      }, 120_000);
    });
  });
}
