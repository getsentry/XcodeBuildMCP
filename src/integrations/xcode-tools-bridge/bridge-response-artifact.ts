import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SerializedBridgeTool } from './core.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { displayPath } from '../../utils/build-preflight.ts';
import { getWorkspaceFilesystemLayout } from '../../utils/log-paths.ts';
import { formatLogTimestamp, shortRandomSuffix } from '../../utils/log-naming.ts';
import { getRuntimeInstance } from '../../utils/runtime-instance.ts';

export interface BridgeCallResponseArtifactInput {
  remoteTool: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
  response: CallToolResult;
}

export interface BridgeToolListResponseArtifactInput {
  refresh?: boolean;
  tools: SerializedBridgeTool[];
}

export interface BridgeResponseArtifact {
  path: string;
}

function sanitizeFilenameSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized.length > 0 ? sanitized : 'remote-tool';
}

function createArtifactPath(subject: string): string {
  const runtime = getRuntimeInstance();
  const stateDir = getWorkspaceFilesystemLayout(runtime.workspaceKey).state;
  const ownerDir = `ownerpid${runtime.pid}_${sanitizeFilenameSegment(runtime.instanceId)}`;
  const fileName = `${formatLogTimestamp()}-${sanitizeFilenameSegment(subject)}-${shortRandomSuffix()}.json`;
  return path.join(stateDir, 'xcode-ide', 'call-tool', ownerDir, fileName);
}

async function writeArtifactFile(
  subject: string,
  artifact: Record<string, unknown>,
): Promise<BridgeResponseArtifact> {
  const artifactPath = createArtifactPath(subject);
  const artifactDir = path.dirname(artifactPath);
  await fs.mkdir(artifactDir, { recursive: true, mode: 0o700 });

  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return { path: displayPath(artifactPath) };
}

export async function writeBridgeCallResponseArtifact(
  input: BridgeCallResponseArtifactInput,
): Promise<BridgeResponseArtifact> {
  return await writeArtifactFile(input.remoteTool, {
    remoteTool: input.remoteTool,
    arguments: input.arguments,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    capturedAt: new Date().toISOString(),
    response: input.response,
  });
}

export async function writeBridgeToolListResponseArtifact(
  input: BridgeToolListResponseArtifactInput,
): Promise<BridgeResponseArtifact> {
  return await writeArtifactFile('list-tools', {
    operation: 'list-tools',
    ...(input.refresh !== undefined ? { refresh: input.refresh } : {}),
    capturedAt: new Date().toISOString(),
    response: {
      toolCount: input.tools.length,
      tools: input.tools,
    },
  });
}
