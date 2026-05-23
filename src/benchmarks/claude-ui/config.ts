import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import * as z from 'zod';
import { sessionDefaultsSchema } from '../../utils/session-defaults-schema.ts';
import type { SessionDefaults } from '../../utils/session-store.ts';
import type { AllowedVariance, BenchmarkConfig, SequenceMode } from './types.ts';

export const sessionDefaultEnvNames: Record<string, string> = {
  workspacePath: 'XCODEBUILDMCP_WORKSPACE_PATH',
  projectPath: 'XCODEBUILDMCP_PROJECT_PATH',
  scheme: 'XCODEBUILDMCP_SCHEME',
  configuration: 'XCODEBUILDMCP_CONFIGURATION',
  simulatorName: 'XCODEBUILDMCP_SIMULATOR_NAME',
  simulatorId: 'XCODEBUILDMCP_SIMULATOR_ID',
  simulatorPlatform: 'XCODEBUILDMCP_SIMULATOR_PLATFORM',
  deviceId: 'XCODEBUILDMCP_DEVICE_ID',
  derivedDataPath: 'XCODEBUILDMCP_DERIVED_DATA_PATH',
  platform: 'XCODEBUILDMCP_PLATFORM',
  bundleId: 'XCODEBUILDMCP_BUNDLE_ID',
  arch: 'XCODEBUILDMCP_ARCH',
  useLatestOS: 'XCODEBUILDMCP_USE_LATEST_OS',
  suppressWarnings: 'XCODEBUILDMCP_SUPPRESS_WARNINGS',
  preferXcodebuild: 'XCODEBUILDMCP_PREFER_XCODEBUILD',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string, source: string): string {
  const raw = value[key];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`${source}: expected non-empty string field '${key}'`);
  }
  return raw;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  source: string,
): string | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`${source}: expected string field '${key}'`);
  }
  return raw;
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  key: string,
  source: string,
): string[] | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    throw new Error(`${source}: expected string array field '${key}'`);
  }
  return raw as string[];
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
  source: string,
): boolean | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') throw new Error(`${source}.${key}: expected boolean`);
  return raw;
}

function readSequenceMode(raw: unknown, source: string): SequenceMode {
  if (raw === 'warn' || raw === 'fail') return raw;
  throw new Error(`${source}: expected 'warn' or 'fail'`);
}

function readSequenceConfig(raw: unknown, source: string): BenchmarkConfig['sequence'] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error(`${source}: expected object`);
  return {
    mode: raw.mode === undefined ? undefined : readSequenceMode(raw.mode, `${source}.mode`),
  };
}

function readOptionalNumber(
  value: Record<string, unknown>,
  key: string,
  source: string,
): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number') throw new Error(`${source}.${key}: expected number`);
  return raw;
}

function readNumberMap(value: unknown, source: string): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${source}: expected object`);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== 'number') throw new Error(`${source}.${key}: expected number`);
      return [key, item];
    }),
  );
}

function readAllowedVariance(raw: unknown, source: string): Partial<AllowedVariance> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error(`${source}: expected object`);

  const variance: Partial<AllowedVariance> = {};
  const totalToolCalls = readOptionalNumber(raw, 'totalToolCalls', source);
  if (totalToolCalls !== undefined) variance.totalToolCalls = totalToolCalls;
  const mcpToolCalls = readOptionalNumber(raw, 'mcpToolCalls', source);
  if (mcpToolCalls !== undefined) variance.mcpToolCalls = mcpToolCalls;
  const uiAutomationCalls = readOptionalNumber(raw, 'uiAutomationCalls', source);
  if (uiAutomationCalls !== undefined) variance.uiAutomationCalls = uiAutomationCalls;
  const wallClockSeconds = readOptionalNumber(raw, 'wallClockSeconds', source);
  if (wallClockSeconds !== undefined) variance.wallClockSeconds = wallClockSeconds;
  const toolCalls = readOptionalNumber(raw, 'toolCalls', source);
  if (toolCalls !== undefined) variance.toolCalls = toolCalls;
  return variance;
}

function readFailurePatterns(raw: unknown, source: string): string[] | undefined {
  const patterns = readOptionalStringArray(
    raw as Record<string, unknown>,
    'failurePatterns',
    source,
  );
  for (const [index, pattern] of (patterns ?? []).entries()) {
    try {
      new RegExp(pattern, 'i');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${source}.failurePatterns[${index}]: invalid regular expression: ${message}`,
      );
    }
  }
  return patterns;
}

function readFirstRunPromptDismissals(
  raw: unknown,
  source: string,
): BenchmarkConfig['firstRunPromptDismissals'] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error(`${source}: expected object`);
  return {
    labels: readOptionalStringArray(raw, 'labels', source) ?? [],
    timeoutSeconds: readOptionalNumber(raw, 'timeoutSeconds', source),
  };
}

export function validateSessionDefaults(
  sessionDefaults: Record<string, unknown> | undefined,
): SessionDefaults | undefined {
  if (!sessionDefaults) return undefined;

  const parsed = sessionDefaultsSchema.strict().safeParse(sessionDefaults);
  if (!parsed.success) {
    throw new Error(`invalid sessionDefaults:\n${formatZodIssues(parsed.error)}`);
  }
  return parsed.data;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}

export function readConfig(raw: unknown, source: string): BenchmarkConfig {
  if (!isRecord(raw)) throw new Error(`${source}: expected YAML object`);
  const config: BenchmarkConfig = {
    name: readString(raw, 'name', source),
    prompt: readString(raw, 'prompt', source),
    workingDirectory: readOptionalString(raw, 'workingDirectory', source),
    expectedToolSequence: readOptionalStringArray(raw, 'expectedToolSequence', source),
    sequence: readSequenceConfig(raw.sequence, `${source}.sequence`),
    failurePatterns: readFailurePatterns(raw, source),
    temporarySimulator: readOptionalBoolean(raw, 'temporarySimulator', source),
    firstRunPromptDismissals: readFirstRunPromptDismissals(
      raw.firstRunPromptDismissals,
      `${source}.firstRunPromptDismissals`,
    ),
  };

  if (raw.sessionDefaults !== undefined) {
    if (!isRecord(raw.sessionDefaults)) {
      throw new Error(`${source}.sessionDefaults: expected object`);
    }
    config.sessionDefaults = validateSessionDefaults(raw.sessionDefaults);
  }
  config.allowedVariance = readAllowedVariance(raw.allowedVariance, `${source}.allowedVariance`);

  if (raw.baseline !== undefined) {
    if (!isRecord(raw.baseline)) throw new Error(`${source}.baseline: expected object`);
    config.baseline = {
      totalToolCalls: readOptionalNumber(raw.baseline, 'totalToolCalls', `${source}.baseline`),
      mcpToolCalls: readOptionalNumber(raw.baseline, 'mcpToolCalls', `${source}.baseline`),
      uiAutomationCalls: readOptionalNumber(
        raw.baseline,
        'uiAutomationCalls',
        `${source}.baseline`,
      ),
      wallClockSeconds: readOptionalNumber(raw.baseline, 'wallClockSeconds', `${source}.baseline`),
      tools: readNumberMap(raw.baseline.tools, `${source}.baseline.tools`),
    };
  }

  return config;
}

export async function loadSuite(suitePath: string): Promise<BenchmarkConfig> {
  const raw = parseYaml(await readFile(suitePath, 'utf8')) as unknown;
  return readConfig(raw, suitePath);
}
