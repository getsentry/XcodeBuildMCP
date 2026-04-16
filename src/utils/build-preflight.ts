import path from 'node:path';
import os from 'node:os';
import { resolveEffectiveDerivedDataPath } from './derived-data-path.ts';
import { sessionStore } from './session-store.ts';

export interface ToolPreflightParams {
  operation:
    | 'Build'
    | 'Build & Run'
    | 'Clean'
    | 'Test'
    | 'List Schemes'
    | 'Show Build Settings'
    | 'Get App Path'
    | 'Coverage Report'
    | 'File Coverage';
  scheme?: string;
  workspacePath?: string;
  projectPath?: string;
  configuration?: string;
  platform?: string;
  simulatorName?: string;
  simulatorId?: string;
  deviceId?: string;
  deviceName?: string;
  derivedDataPath?: string;
  arch?: string;
  xcresultPath?: string;
  file?: string;
  targetFilter?: string;
}

export function displayPath(filePath: string): string {
  const cwd = process.cwd();
  const relative = path.relative(cwd, filePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  const home = os.homedir();
  if (filePath === home) {
    return '~';
  }
  if (filePath.startsWith(home + '/')) {
    return '~/' + filePath.slice(home.length + 1);
  }

  return filePath;
}

const OPERATION_EMOJI: Record<ToolPreflightParams['operation'], string> = {
  Build: '\u{1F528}',
  'Build & Run': '\u{1F680}',
  Clean: '\u{1F9F9}',
  Test: '\u{1F9EA}',
  'List Schemes': '\u{1F50D}',
  'Show Build Settings': '\u{1F50D}',
  'Get App Path': '\u{1F50D}',
  'Coverage Report': '\u{1F4CA}',
  'File Coverage': '\u{1F4CA}',
};

export function formatToolPreflight(params: ToolPreflightParams): string {
  const emoji = OPERATION_EMOJI[params.operation];
  const lines: string[] = [`${emoji} ${params.operation}`, ''];

  if (params.scheme) {
    lines.push(`   Scheme: ${params.scheme}`);
  }

  if (params.workspacePath) {
    lines.push(`   Workspace: ${displayPath(params.workspacePath)}`);
  } else if (params.projectPath) {
    lines.push(`   Project: ${displayPath(params.projectPath)}`);
  }

  if (params.configuration) {
    lines.push(`   Configuration: ${params.configuration}`);
  }
  if (params.platform) {
    lines.push(`   Platform: ${params.platform}`);
  }

  if (params.simulatorName) {
    lines.push(`   Simulator: ${params.simulatorName}`);
  } else if (params.simulatorId) {
    lines.push(`   Simulator: ${params.simulatorId}`);
  }

  if (params.deviceId) {
    const deviceLabel = params.deviceName
      ? `${params.deviceName} (${params.deviceId})`
      : params.deviceId;
    lines.push(`   Device: ${deviceLabel}`);
  }

  lines.push(
    `   Derived Data: ${displayPath(resolveEffectiveDerivedDataPath(params.derivedDataPath ?? sessionStore.get('derivedDataPath')))}`,
  );

  if (params.arch) {
    lines.push(`   Architecture: ${params.arch}`);
  }

  if (params.xcresultPath) {
    lines.push(`   xcresult: ${displayPath(params.xcresultPath)}`);
  }

  if (params.file) {
    lines.push(`   File: ${params.file}`);
  }

  if (params.targetFilter) {
    lines.push(`   Target Filter: ${params.targetFilter}`);
  }

  lines.push('');

  return lines.join('\n');
}
