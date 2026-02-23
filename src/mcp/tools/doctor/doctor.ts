/**
 * Doctor Plugin: Doctor Tool
 *
 * Provides comprehensive information about the MCP server environment.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { version } from '../../../utils/version/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { getConfig } from '../../../utils/config-store.ts';
import { detectXcodeRuntime } from '../../../utils/xcode-process.ts';
import { type DoctorDependencies, createDoctorDependencies } from './lib/doctor.deps.ts';
import { peekXcodeToolsBridgeManager } from '../../../integrations/xcode-tools-bridge/index.ts';
import { getMcpBridgeAvailability } from '../../../integrations/xcode-tools-bridge/core.ts';

// Constants
const LOG_PREFIX = '[Doctor]';
const USER_HOME_PATH_PATTERN = /\/Users\/[^/\s]+/g;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passphrase|api[_-]?key|auth|cookie|session|private[_-]?key)/i;
const SECRET_VALUE_PATTERN =
  /((token|secret|password|passphrase|api[_-]?key|auth|cookie|session|private[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi;

// Define schema as ZodObject
const doctorSchema = z.object({
  nonRedacted: z
    .boolean()
    .optional()
    .describe('Opt-in: when true, disable redaction and include full raw doctor output.'),
});

// Use z.infer for type safety
type DoctorParams = z.infer<typeof doctorSchema>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactPathLikeValue(value: string, projectNames: string[], piiTerms: string[]): string {
  let output = value.replace(USER_HOME_PATH_PATTERN, '/Users/<redacted>');
  for (const projectName of projectNames) {
    const escaped = escapeRegExp(projectName);
    output = output.replace(new RegExp(`/${escaped}(?=[:/]|$)`, 'g'), '/<redacted>');
    output = output.replace(
      new RegExp(
        `${escaped}(?=[.](xcodeproj|xcworkspace|xcuserstate|swiftpm|xcconfig)(?=$|[^A-Za-z0-9_]))`,
        'g',
      ),
      '<redacted>',
    );
  }
  for (const term of piiTerms) {
    const escaped = escapeRegExp(term);
    output = output.replace(new RegExp(`\\b${escaped}\\b`, 'g'), '<redacted>');
  }

  output = output.replace(SECRET_VALUE_PATTERN, '$1<redacted>');
  return output;
}

function sanitizeValue(
  value: unknown,
  keyPath: string,
  projectNames: string[],
  piiTerms: string[],
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (SENSITIVE_KEY_PATTERN.test(keyPath) || /(^|\.)(USER|username|hostname)$/.test(keyPath)) {
      return '<redacted>';
    }
    return redactPathLikeValue(value, projectNames, piiTerms);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeValue(item, `${keyPath}[${index}]`, projectNames, piiTerms),
    );
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const nextPath = keyPath ? `${keyPath}.${entryKey}` : entryKey;
      output[entryKey] = sanitizeValue(entryValue, nextPath, projectNames, piiTerms);
    }
    return output;
  }

  return value;
}

async function checkLldbDapAvailability(executor: CommandExecutor): Promise<boolean> {
  try {
    const result = await executor(['xcrun', '--find', 'lldb-dap'], 'Check lldb-dap');
    return result.success && result.output.trim().length > 0;
  } catch {
    return false;
  }
}

type XcodeToolsBridgeDoctorInfo =
  | {
      available: true;
      workflowEnabled: boolean;
      bridgePath: string | null;
      xcodeRunning: boolean | null;
      connected: boolean;
      bridgePid: number | null;
      proxiedToolCount: number;
      lastError: string | null;
    }
  | { available: false; reason: string };

async function getXcodeToolsBridgeDoctorInfo(
  executor: CommandExecutor,
  workflowEnabled: boolean,
): Promise<XcodeToolsBridgeDoctorInfo> {
  try {
    const manager = peekXcodeToolsBridgeManager();
    if (manager) {
      const status = await manager.getStatus();
      return {
        available: true,
        workflowEnabled: status.workflowEnabled,
        bridgePath: status.bridgePath,
        xcodeRunning: status.xcodeRunning,
        connected: status.connected,
        bridgePid: status.bridgePid,
        proxiedToolCount: status.proxiedToolCount,
        lastError: status.lastError,
      };
    }

    const bridgeInfo = await getMcpBridgeAvailability();
    const bridgePath = bridgeInfo.available ? bridgeInfo.path : null;
    const xcodeRunningResult = await executor(['pgrep', '-x', 'Xcode'], 'Check Xcode process');
    const xcodeRunning = xcodeRunningResult.success
      ? xcodeRunningResult.output.trim().length > 0
      : null;
    return {
      available: true,
      workflowEnabled,
      bridgePath,
      xcodeRunning,
      connected: false,
      bridgePid: null,
      proxiedToolCount: 0,
      lastError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: message };
  }
}

/**
 * Run the doctor tool and return the results
 */
export async function runDoctor(
  params: DoctorParams,
  deps: DoctorDependencies,
  showAsciiLogo = false,
): Promise<ToolResponse> {
  const prevSilence = process.env.XCODEBUILDMCP_SILENCE_LOGS;
  process.env.XCODEBUILDMCP_SILENCE_LOGS = 'true';
  log('info', `${LOG_PREFIX}: Running doctor tool`);

  const xcodemakeEnabled = deps.features.isXcodemakeEnabled();
  const requiredBinaries = ['axe', 'mise', ...(xcodemakeEnabled ? ['xcodemake'] : [])];
  const binaryStatus: Record<string, { available: boolean; version?: string }> = {};
  for (const binary of requiredBinaries) {
    binaryStatus[binary] = await deps.binaryChecker.checkBinaryAvailability(binary);
  }

  const xcodeInfo = await deps.xcode.getXcodeInfo();
  const envVars = deps.env.getEnvironmentVariables();
  const systemInfo = deps.env.getSystemInfo();
  const nodeInfo = deps.env.getNodeInfo();
  const xcodeRuntime = await detectXcodeRuntime(deps.commandExecutor);
  const axeAvailable = deps.features.areAxeToolsAvailable();
  const manifestToolInfo = await deps.manifest.getManifestToolInfo();
  const runtimeInfo = await deps.runtime.getRuntimeToolInfo();
  const runtimeRegistration = runtimeInfo ?? {
    enabledWorkflows: [],
    registeredToolCount: 0,
  };
  const xcodeIdeWorkflowEnabled = runtimeRegistration.enabledWorkflows.includes('xcode-ide');
  const runtimeNote = runtimeInfo ? null : 'Runtime registry unavailable.';
  const xcodemakeBinaryAvailable = deps.features.isXcodemakeBinaryAvailable();
  const makefileExists = xcodemakeEnabled ? deps.features.doesMakefileExist('./') : null;
  const lldbDapAvailable = await checkLldbDapAvailability(deps.commandExecutor);
  const selectedDebuggerBackend = getConfig().debuggerBackend;
  const uiDebuggerGuardMode = getConfig().uiDebuggerGuardMode;
  const dapSelected = selectedDebuggerBackend === 'dap';
  const xcodeToolsBridge = await getXcodeToolsBridgeDoctorInfo(
    deps.commandExecutor,
    xcodeIdeWorkflowEnabled,
  );
  const axeVideoCaptureSupported =
    axeAvailable && (await deps.features.isAxeAtLeastVersion('1.1.0', deps.commandExecutor));

  const doctorInfoRaw = {
    serverVersion: String(version),
    timestamp: new Date().toISOString(),
    system: systemInfo,
    node: nodeInfo,
    processTree: xcodeRuntime.processTree,
    processTreeError: xcodeRuntime.error,
    runningUnderXcode: xcodeRuntime.runningUnderXcode,
    xcode: xcodeInfo,
    dependencies: binaryStatus,
    environmentVariables: envVars,
    features: {
      axe: {
        available: axeAvailable,
        uiAutomationSupported: axeAvailable,
        videoCaptureSupported: axeVideoCaptureSupported,
      },
      xcodemake: {
        enabled: xcodemakeEnabled,
        binaryAvailable: xcodemakeBinaryAvailable,
        makefileExists,
      },
      mise: {
        running_under_mise: Boolean(process.env.XCODEBUILDMCP_RUNNING_UNDER_MISE),
        available: binaryStatus['mise'].available,
      },
      debugger: {
        dap: {
          available: lldbDapAvailable,
          selected: selectedDebuggerBackend,
        },
      },
    },
    manifestTools: manifestToolInfo,
    xcodeToolsBridge,
  } as const;

  const currentCwdName = process.cwd().split('/').filter(Boolean).at(-1) ?? '';
  const nodeCwdName = nodeInfo.cwd.split('/').filter(Boolean).at(-1) ?? '';
  const projectNames = [currentCwdName, nodeCwdName].filter(
    (name, index, all) => name.length > 0 && name !== '<redacted>' && all.indexOf(name) === index,
  );
  const piiTerms = [
    envVars.USER,
    systemInfo.username,
    systemInfo.hostname,
    process.env.USER,
  ].filter((value, index, all): value is string => {
    if (!value || value === '<redacted>') return false;
    return all.indexOf(value) === index;
  });

  const doctorInfo = params.nonRedacted
    ? doctorInfoRaw
    : (sanitizeValue(doctorInfoRaw, '', projectNames, piiTerms) as typeof doctorInfoRaw);

  // Custom ASCII banner (multiline)
  const asciiLogo = `
██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗██████╗ ██╗   ██╗██╗██╗     ██████╗ ███╗   ███╗ ██████╗██████╗
╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗██║   ██║██║██║     ██╔══██╗████╗ ████║██╔════╝██╔══██╗
 ╚███╔╝ ██║     ██║   ██║██║  ██║█████╗  ██████╔╝██║   ██║██║██║     ██║  ██║██╔████╔██║██║     ██████╔╝
 ██╔██╗ ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗██║   ██║██║██║     ██║  ██║██║╚██╔╝██║██║     ██╔═══╝
██╔╝ ██╗╚██████╗╚██████╔╝██████╔╝███████╗██████╔╝╚██████╔╝██║███████╗██████╔╝██║ ╚═╝ ██║╚██████╗██║
╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝ ╚═╝     ╚═╝ ╚═════╝╚═╝

██████╗  ██████╗  ██████╗████████╗ ██████╗ ██████╗
██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝
██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗
██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║
╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
`;

  const RESET = '\x1b[0m';
  // 256-color: orangey-pink foreground and lighter shade for outlines
  const FOREGROUND = '\x1b[38;5;209m';
  const SHADOW = '\x1b[38;5;217m';

  function colorizeAsciiArt(ascii: string): string {
    const lines = ascii.split('\n');
    const coloredLines: string[] = [];
    const shadowChars = new Set([
      '╔',
      '╗',
      '╝',
      '╚',
      '═',
      '║',
      '╦',
      '╩',
      '╠',
      '╣',
      '╬',
      '┌',
      '┐',
      '└',
      '┘',
      '│',
      '─',
    ]);
    for (const line of lines) {
      let colored = '';
      for (const ch of line) {
        if (ch === '█') {
          colored += `${FOREGROUND}${ch}${RESET}`;
        } else if (shadowChars.has(ch)) {
          colored += `${SHADOW}${ch}${RESET}`;
        } else {
          colored += ch;
        }
      }
      coloredLines.push(colored + RESET);
    }
    return coloredLines.join('\n');
  }

  const outputLines = [];

  // Only show ASCII logo when explicitly requested (CLI usage)
  if (showAsciiLogo) {
    outputLines.push(colorizeAsciiArt(asciiLogo));
  }

  outputLines.push(
    'XcodeBuildMCP Doctor',
    `\nGenerated: ${doctorInfo.timestamp}`,
    `Server Version: ${doctorInfo.serverVersion}`,
    `Output Mode: ${params.nonRedacted ? '⚠️ Non-redacted (opt-in)' : 'Redacted (default)'}`,
  );

  const formattedOutput = [
    ...outputLines,

    `\n## System Information`,
    ...Object.entries(doctorInfo.system).map(([key, value]) => `- ${key}: ${value}`),

    `\n## Node.js Information`,
    ...Object.entries(doctorInfo.node).map(([key, value]) => `- ${key}: ${value}`),

    `\n## Process Tree`,
    `- Running under Xcode: ${doctorInfo.runningUnderXcode ? '✅ Yes' : '❌ No'}`,
    ...(doctorInfo.processTree.length > 0
      ? doctorInfo.processTree.map(
          (entry) =>
            `- ${entry.pid} (ppid ${entry.ppid}): ${entry.name}${
              entry.command ? ` — ${entry.command}` : ''
            }`,
        )
      : ['- (unavailable)']),
    ...(doctorInfo.processTreeError ? [`- Error: ${doctorInfo.processTreeError}`] : []),

    `\n## Xcode Information`,
    ...('error' in doctorInfo.xcode
      ? [`- Error: ${doctorInfo.xcode.error}`]
      : Object.entries(doctorInfo.xcode).map(([key, value]) => `- ${key}: ${value}`)),

    `\n## Dependencies`,
    ...Object.entries(doctorInfo.dependencies).map(
      ([binary, status]) =>
        `- ${binary}: ${status.available ? `✅ ${status.version ?? 'Available'}` : '❌ Not found'}`,
    ),

    `\n## Environment Variables`,
    ...Object.entries(doctorInfo.environmentVariables)
      .filter(([key]) => key !== 'PATH' && key !== 'PYTHONPATH') // These are too long, handle separately
      .map(([key, value]) => `- ${key}: ${value ?? '(not set)'}`),

    `\n### PATH`,
    `\`\`\``,
    `${doctorInfo.environmentVariables.PATH ?? '(not set)'}`.split(':').join('\n'),
    `\`\`\``,

    `\n## Feature Status`,
    `\n### UI Automation (axe)`,
    `- Available: ${doctorInfo.features.axe.available ? '✅ Yes' : '❌ No'}`,
    `- UI Automation Supported: ${doctorInfo.features.axe.uiAutomationSupported ? '✅ Yes' : '❌ No'}`,
    `- Simulator Video Capture Supported (AXe >= 1.1.0): ${doctorInfo.features.axe.videoCaptureSupported ? '✅ Yes' : '❌ No'}`,
    `- UI-Debugger Guard Mode: ${uiDebuggerGuardMode}`,

    `\n### Incremental Builds`,
    `- Enabled: ${doctorInfo.features.xcodemake.enabled ? '✅ Yes' : '❌ No'}`,
    `- xcodemake Binary Available: ${doctorInfo.features.xcodemake.binaryAvailable ? '✅ Yes' : '❌ No'}`,
    `- Makefile exists (cwd): ${doctorInfo.features.xcodemake.makefileExists === null ? '(not checked: incremental builds disabled)' : doctorInfo.features.xcodemake.makefileExists ? '✅ Yes' : '❌ No'}`,

    `\n### Mise Integration`,
    `- Running under mise: ${doctorInfo.features.mise.running_under_mise ? '✅ Yes' : '❌ No'}`,
    `- Mise available: ${doctorInfo.features.mise.available ? '✅ Yes' : '❌ No'}`,

    `\n### Debugger Backend (DAP)`,
    `- lldb-dap available: ${doctorInfo.features.debugger.dap.available ? '✅ Yes' : '❌ No'}`,
    `- Selected backend: ${doctorInfo.features.debugger.dap.selected}`,
    ...(dapSelected && !lldbDapAvailable
      ? [
          `- Warning: DAP backend selected but lldb-dap not available. Set XCODEBUILDMCP_DEBUGGER_BACKEND=lldb-cli to use the CLI backend.`,
        ]
      : []),

    `\n### Manifest Tool Inventory`,
    ...('error' in doctorInfo.manifestTools
      ? [`- Error: ${doctorInfo.manifestTools.error}`]
      : [
          `- Total Unique Tools: ${doctorInfo.manifestTools.totalTools}`,
          `- Workflow Count: ${doctorInfo.manifestTools.workflowCount}`,
          ...Object.entries(doctorInfo.manifestTools.toolsByWorkflow).map(
            ([workflow, count]) => `- ${workflow}: ${count} tools`,
          ),
        ]),

    `\n### Runtime Tool Registration`,
    `- Enabled Workflows: ${runtimeRegistration.enabledWorkflows.length}`,
    `- Registered Tools: ${runtimeRegistration.registeredToolCount}`,
    ...(runtimeNote ? [`- Note: ${runtimeNote}`] : []),
    ...(runtimeRegistration.enabledWorkflows.length > 0
      ? [`- Workflows: ${runtimeRegistration.enabledWorkflows.join(', ')}`]
      : []),

    `\n### Xcode IDE Bridge (mcpbridge)`,
    ...(doctorInfo.xcodeToolsBridge.available
      ? [
          `- Workflow enabled: ${doctorInfo.xcodeToolsBridge.workflowEnabled ? '✅ Yes' : '❌ No'}`,
          `- mcpbridge path: ${doctorInfo.xcodeToolsBridge.bridgePath ?? '(not found)'}`,
          `- Xcode running: ${doctorInfo.xcodeToolsBridge.xcodeRunning ?? '(unknown)'}`,
          `- Connected: ${doctorInfo.xcodeToolsBridge.connected ? '✅ Yes' : '❌ No'}`,
          `- Bridge PID: ${doctorInfo.xcodeToolsBridge.bridgePid ?? '(none)'}`,
          `- Proxied tools: ${doctorInfo.xcodeToolsBridge.proxiedToolCount}`,
          `- Last error: ${doctorInfo.xcodeToolsBridge.lastError ?? '(none)'}`,
          `- Note: Bridge debug tools (status/sync/disconnect) are only registered when debug: true`,
        ]
      : [`- Unavailable: ${doctorInfo.xcodeToolsBridge.reason}`]),

    `\n## Tool Availability Summary`,
    `- Build Tools: ${!('error' in doctorInfo.xcode) ? '\u2705 Available' : '\u274c Not available'}`,
    `- UI Automation Tools: ${doctorInfo.features.axe.uiAutomationSupported ? '\u2705 Available' : '\u274c Not available'}`,
    `- Incremental Build Support: ${doctorInfo.features.xcodemake.binaryAvailable && doctorInfo.features.xcodemake.enabled ? '\u2705 Available & Enabled' : doctorInfo.features.xcodemake.binaryAvailable ? '\u2705 Available but Disabled' : '\u274c Not available'}`,

    `\n## Sentry`,
    `- Sentry enabled: ${doctorInfo.environmentVariables.SENTRY_DISABLED !== 'true' ? '✅ Yes' : '❌ No'}`,

    `\n## Troubleshooting Tips`,
    `- If UI automation tools are not available, install axe: \`brew tap cameroncooke/axe && brew install axe\``,
    `- If incremental build support is not available, install xcodemake (https://github.com/cameroncooke/xcodemake) and ensure it is executable and available in your PATH`,
    `- To enable xcodemake, set environment variable: \`export INCREMENTAL_BUILDS_ENABLED=1\``,
    `- For mise integration, follow instructions in the README.md file`,
  ].join('\n');

  const result: ToolResponse = {
    content: [
      {
        type: 'text',
        text: formattedOutput,
      },
    ],
  };
  // Restore previous silence flag
  if (prevSilence === undefined) {
    delete process.env.XCODEBUILDMCP_SILENCE_LOGS;
  } else {
    process.env.XCODEBUILDMCP_SILENCE_LOGS = prevSilence;
  }
  return result;
}

export async function doctorLogic(
  params: DoctorParams,
  executor: CommandExecutor,
  showAsciiLogo = false,
): Promise<ToolResponse> {
  const deps = createDoctorDependencies(executor);
  return runDoctor(params, deps, showAsciiLogo);
}

// MCP wrapper that ensures ASCII logo is never shown for MCP server calls
async function doctorMcpHandler(
  params: DoctorParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  return doctorLogic(params, executor, false); // Always false for MCP
}

export const schema = doctorSchema.shape; // MCP SDK compatibility

export const handler = createTypedTool(doctorSchema, doctorMcpHandler, getDefaultCommandExecutor);

export type { DoctorDependencies } from './lib/doctor.deps.ts';
