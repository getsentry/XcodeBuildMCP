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
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { getConfig } from '../../../utils/config-store.ts';
import { detectXcodeRuntime } from '../../../utils/xcode-process.ts';
import { type DoctorDependencies, createDoctorDependencies } from './lib/doctor.deps.ts';
import { peekXcodeToolsBridgeManager } from '../../../integrations/xcode-tools-bridge/index.ts';
import { getMcpBridgeAvailability } from '../../../integrations/xcode-tools-bridge/core.ts';
import { header, statusLine, section, detailTree } from '../../../utils/tool-event-builders.ts';
import { renderEvents } from '../../../rendering/render.ts';

const LOG_PREFIX = '[Doctor]';
const USER_HOME_PATH_PATTERN = /\/Users\/[^/\s]+/g;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passphrase|api[_-]?key|auth|cookie|session|private[_-]?key)/i;
const SECRET_VALUE_PATTERN =
  /((token|secret|password|passphrase|api[_-]?key|auth|cookie|session|private[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi;

const doctorSchema = z.object({
  nonRedacted: z
    .boolean()
    .optional()
    .describe('Opt-in: when true, disable redaction and include full raw doctor output.'),
});

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
 * Run the doctor tool and return the results.
 */
export async function runDoctor(params: DoctorParams, deps: DoctorDependencies) {
  const prevSilence = process.env.XCODEBUILDMCP_SILENCE_LOGS;
  process.env.XCODEBUILDMCP_SILENCE_LOGS = 'true';
  log('info', `${LOG_PREFIX}: Running doctor tool`);
  try {
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

    const events: PipelineEvent[] = [
      header('XcodeBuildMCP Doctor', [
        { label: 'Generated', value: doctorInfo.timestamp },
        { label: 'Server Version', value: doctorInfo.serverVersion },
        {
          label: 'Output Mode',
          value: params.nonRedacted ? 'Non-redacted (opt-in)' : 'Redacted (default)',
        },
      ]),
    ];

    // System Information
    events.push(
      detailTree(
        Object.entries(doctorInfo.system).map(([key, value]) => ({
          label: key,
          value: String(value),
        })),
      ),
    );

    // Node.js Information
    events.push(
      section(
        'Node.js Information',
        Object.entries(doctorInfo.node).map(([key, value]) => `${key}: ${value}`),
      ),
    );

    // Process Tree
    const processTreeLines: string[] = [
      `Running under Xcode: ${doctorInfo.runningUnderXcode ? 'Yes' : 'No'}`,
    ];
    if (doctorInfo.processTree.length > 0) {
      for (const entry of doctorInfo.processTree) {
        processTreeLines.push(
          `${entry.pid} (ppid ${entry.ppid}): ${entry.name}${entry.command ? ` -- ${entry.command}` : ''}`,
        );
      }
    } else {
      processTreeLines.push('(unavailable)');
    }
    if (doctorInfo.processTreeError) {
      processTreeLines.push(`Error: ${doctorInfo.processTreeError}`);
    }
    events.push(section('Process Tree', processTreeLines));

    // Xcode Information
    if ('error' in doctorInfo.xcode) {
      events.push(
        section('Xcode Information', [`Error: ${doctorInfo.xcode.error}`], { icon: 'cross' }),
      );
    } else {
      events.push(
        section(
          'Xcode Information',
          Object.entries(doctorInfo.xcode).map(([key, value]) => `${key}: ${value}`),
        ),
      );
    }

    // Dependencies
    events.push(
      section(
        'Dependencies',
        Object.entries(doctorInfo.dependencies).map(
          ([binary, status]) =>
            `${binary}: ${status.available ? (status.version ?? 'Available') : 'Not found'}`,
        ),
      ),
    );

    // Environment Variables
    const envLines = Object.entries(doctorInfo.environmentVariables)
      .filter(([key]) => key !== 'PATH' && key !== 'PYTHONPATH')
      .map(([key, value]) => `${key}: ${value ?? '(not set)'}`);
    events.push(section('Environment Variables', envLines));

    // PATH
    const pathValue = doctorInfo.environmentVariables.PATH ?? '(not set)';
    events.push(section('PATH', pathValue.split(':')));

    // UI Automation (axe)
    const axeLines: string[] = [
      `Available: ${doctorInfo.features.axe.available ? 'Yes' : 'No'}`,
      `UI Automation Supported: ${doctorInfo.features.axe.uiAutomationSupported ? 'Yes' : 'No'}`,
      `Simulator Video Capture Supported (AXe >= 1.1.0): ${doctorInfo.features.axe.videoCaptureSupported ? 'Yes' : 'No'}`,
      `UI-Debugger Guard Mode: ${uiDebuggerGuardMode}`,
    ];
    events.push(section('UI Automation (axe)', axeLines));

    // Incremental Builds
    let makefileStatus: string;
    if (doctorInfo.features.xcodemake.makefileExists === null) {
      makefileStatus = '(not checked: incremental builds disabled)';
    } else {
      makefileStatus = doctorInfo.features.xcodemake.makefileExists ? 'Yes' : 'No';
    }
    events.push(
      section('Incremental Builds', [
        `Enabled: ${doctorInfo.features.xcodemake.enabled ? 'Yes' : 'No'}`,
        `xcodemake Binary Available: ${doctorInfo.features.xcodemake.binaryAvailable ? 'Yes' : 'No'}`,
        `Makefile exists (cwd): ${makefileStatus}`,
      ]),
    );

    // Mise Integration
    events.push(
      section('Mise Integration', [
        `Running under mise: ${doctorInfo.features.mise.running_under_mise ? 'Yes' : 'No'}`,
        `Mise available: ${doctorInfo.features.mise.available ? 'Yes' : 'No'}`,
      ]),
    );

    // Debugger Backend (DAP)
    const debuggerLines: string[] = [
      `lldb-dap available: ${doctorInfo.features.debugger.dap.available ? 'Yes' : 'No'}`,
      `Selected backend: ${doctorInfo.features.debugger.dap.selected}`,
    ];
    if (dapSelected && !lldbDapAvailable) {
      debuggerLines.push(
        'Warning: DAP backend selected but lldb-dap not available. Set XCODEBUILDMCP_DEBUGGER_BACKEND=lldb-cli to use the CLI backend.',
      );
    }
    events.push(section('Debugger Backend (DAP)', debuggerLines));

    // Manifest Tool Inventory
    if ('error' in doctorInfo.manifestTools) {
      events.push(
        section('Manifest Tool Inventory', [`Error: ${doctorInfo.manifestTools.error}`], {
          icon: 'cross',
        }),
      );
    } else {
      events.push(
        section('Manifest Tool Inventory', [
          `Total Unique Tools: ${doctorInfo.manifestTools.totalTools}`,
          `Workflow Count: ${doctorInfo.manifestTools.workflowCount}`,
          ...Object.entries(doctorInfo.manifestTools.toolsByWorkflow).map(
            ([workflow, count]) => `${workflow}: ${count} tools`,
          ),
        ]),
      );
    }

    // Runtime Tool Registration
    const runtimeLines: string[] = [
      `Enabled Workflows: ${runtimeRegistration.enabledWorkflows.length}`,
      `Registered Tools: ${runtimeRegistration.registeredToolCount}`,
    ];
    if (runtimeNote) {
      runtimeLines.push(`Note: ${runtimeNote}`);
    }
    if (runtimeRegistration.enabledWorkflows.length > 0) {
      runtimeLines.push(`Workflows: ${runtimeRegistration.enabledWorkflows.join(', ')}`);
    }
    events.push(section('Runtime Tool Registration', runtimeLines));

    // Xcode IDE Bridge
    if (doctorInfo.xcodeToolsBridge.available) {
      events.push(
        section('Xcode IDE Bridge (mcpbridge)', [
          `Workflow enabled: ${doctorInfo.xcodeToolsBridge.workflowEnabled ? 'Yes' : 'No'}`,
          `mcpbridge path: ${doctorInfo.xcodeToolsBridge.bridgePath ?? '(not found)'}`,
          `Xcode running: ${doctorInfo.xcodeToolsBridge.xcodeRunning ?? '(unknown)'}`,
          `Connected: ${doctorInfo.xcodeToolsBridge.connected ? 'Yes' : 'No'}`,
          `Bridge PID: ${doctorInfo.xcodeToolsBridge.bridgePid ?? '(none)'}`,
          `Proxied tools: ${doctorInfo.xcodeToolsBridge.proxiedToolCount}`,
          `Last error: ${doctorInfo.xcodeToolsBridge.lastError ?? '(none)'}`,
          'Note: Bridge debug tools (status/sync/disconnect) are only registered when debug: true',
        ]),
      );
    } else {
      events.push(
        section('Xcode IDE Bridge (mcpbridge)', [
          `Unavailable: ${doctorInfo.xcodeToolsBridge.reason}`,
        ]),
      );
    }

    // Tool Availability Summary
    const buildToolsAvailable = !('error' in doctorInfo.xcode);
    let incrementalStatus: string;
    if (doctorInfo.features.xcodemake.binaryAvailable && doctorInfo.features.xcodemake.enabled) {
      incrementalStatus = 'Available & Enabled';
    } else if (doctorInfo.features.xcodemake.binaryAvailable) {
      incrementalStatus = 'Available but Disabled';
    } else {
      incrementalStatus = 'Not available';
    }
    events.push(
      section('Tool Availability Summary', [
        `Build Tools: ${buildToolsAvailable ? 'Available' : 'Not available'}`,
        `UI Automation Tools: ${doctorInfo.features.axe.uiAutomationSupported ? 'Available' : 'Not available'}`,
        `Incremental Build Support: ${incrementalStatus}`,
      ]),
    );

    // Sentry
    events.push(
      section('Sentry', [
        `Sentry enabled: ${doctorInfo.environmentVariables.SENTRY_DISABLED !== 'true' ? 'Yes' : 'No'}`,
      ]),
    );

    // Troubleshooting Tips
    events.push(
      section('Troubleshooting Tips', [
        'If UI automation tools are not available, install axe: brew tap cameroncooke/axe && brew install axe',
        'If incremental build support is not available, install xcodemake (https://github.com/cameroncooke/xcodemake) and ensure it is executable and available in your PATH',
        'To enable xcodemake, set environment variable: export INCREMENTAL_BUILDS_ENABLED=1',
        'For mise integration, follow instructions in the README.md file',
      ]),
    );

    events.push(statusLine('success', 'Doctor diagnostics complete'));

    const rendered = renderEvents(events, 'text');
    const hasError = events.some(
      (e) =>
        (e.type === 'status-line' && e.level === 'error') ||
        (e.type === 'summary' && e.status === 'FAILED'),
    );
    return {
      content: [{ type: 'text' as const, text: rendered }],
      isError: hasError || undefined,
      _meta: { events: [...events] },
    };
  } finally {
    if (prevSilence === undefined) {
      delete process.env.XCODEBUILDMCP_SILENCE_LOGS;
    } else {
      process.env.XCODEBUILDMCP_SILENCE_LOGS = prevSilence;
    }
  }
}

export async function doctorLogic(params: DoctorParams, executor: CommandExecutor) {
  const deps = createDoctorDependencies(executor);
  return runDoctor(params, deps);
}

export async function doctorToolLogic(
  params: DoctorParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const response = await doctorLogic(params, executor);

  const events = response._meta?.events;
  if (Array.isArray(events)) {
    for (const event of events as PipelineEvent[]) {
      ctx.emit(event);
    }
  }
}

export const schema = doctorSchema.shape;

export const handler = createTypedTool(doctorSchema, doctorToolLogic, getDefaultCommandExecutor);

export type { DoctorDependencies } from './lib/doctor.deps.ts';
