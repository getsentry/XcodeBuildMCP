import { describe, expect, it } from 'vitest';
import { toStructuredEnvelope } from '../structured-output-envelope.ts';
import type { NextStep } from '../../types/common.ts';
import type {
  BuildResultDomainResult,
  DeviceListDomainResult,
} from '../../types/domain-results.ts';
import type { StructuredOutputEnvelope } from '../../types/structured-output.ts';

describe('toStructuredEnvelope', () => {
  it('strips kind, didError, and error from the data payload', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [
        {
          name: 'iPhone 16',
          deviceId: 'DEVICE-1',
          platform: 'iOS',
          state: 'connected',
          isAvailable: true,
          osVersion: '18.0',
        },
      ],
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '1')).toEqual({
      schema: 'xcodebuildmcp.output.device-list',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        devices: result.devices,
      },
    });
  });

  it('uses null data when the domain result has no schema payload fields', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: true,
      error: 'Build failed',
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.build-result', '1')).toEqual({
      schema: 'xcodebuildmcp.output.build-result',
      schemaVersion: '1',
      didError: true,
      error: 'Build failed',
      data: null,
    });
  });

  it('omits nextSteps when no serializable steps are provided', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: true,
      error: 'Build failed',
    };
    const expectedEnvelope = {
      schema: 'xcodebuildmcp.output.build-result',
      schemaVersion: '1',
      didError: true,
      error: 'Build failed',
      data: null,
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.build-result', '1', { nextSteps: [] }),
    ).toEqual(expectedEnvelope);
  });

  it('does not serialize next steps on error envelopes because the error schema has no nextSteps field', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: true,
      error: 'Build failed',
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.error', '1', {
        nextSteps: [
          {
            label: 'Retry build',
            cliTool: 'build',
            workflow: 'project',
            params: { scheme: 'CalculatorApp' },
          },
        ],
      }),
    ).toEqual({
      schema: 'xcodebuildmcp.output.error',
      schemaVersion: '1',
      didError: true,
      error: 'Build failed',
      data: null,
    });
  });

  it('serializes next steps as rendered CLI command lines by default sorted by priority', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [],
    };
    const nextSteps: NextStep[] = [
      {
        tool: 'launch_app_sim',
        cliTool: 'launch-app',
        workflow: 'simulator',
        label: 'Launch app',
        params: { simulatorId: 'SIM-1' },
        priority: 20,
        when: 'success',
      },
      {
        tool: 'boot_sim',
        cliTool: 'boot',
        workflow: 'simulator',
        label: 'Boot the simulator',
        params: { simulatorId: 'SIM-1', useLatestOS: true },
        priority: 10,
        when: 'success',
      },
    ];

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '2', { nextSteps }),
    ).toEqual({
      schema: 'xcodebuildmcp.output.device-list',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        devices: [],
      },
      nextSteps: [
        'Boot the simulator: xcodebuildmcp simulator boot --simulator-id SIM-1 --use-latest-os',
        'Launch app: xcodebuildmcp simulator launch-app --simulator-id SIM-1',
      ],
    });
  });

  it('shell-escapes only JSON next step arguments that need quoting', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [],
    };
    const nextSteps: NextStep[] = [
      {
        tool: 'launch_sim',
        cliTool: 'launch',
        workflow: 'simulator',
        label: 'Launch app',
        params: {
          simulatorId: 'SIM-1',
          appPath: '/tmp/My App.app',
          displayName: "Cam's App",
        },
      },
    ];

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '2', { nextSteps }),
    ).toMatchObject({
      nextSteps: [
        "Launch app: xcodebuildmcp simulator launch --simulator-id SIM-1 --app-path '/tmp/My App.app' --display-name 'Cam'\\''s App'",
      ],
    });
  });

  it('serializes CLI next steps when only cliTool is present', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [],
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '2', {
        nextSteps: [
          {
            cliTool: 'list',
            workflow: 'simulator',
            label: 'List simulators',
            params: { platform: 'iOS Simulator' },
          },
        ],
      }),
    ).toMatchObject({
      nextSteps: ["List simulators: xcodebuildmcp simulator list --platform 'iOS Simulator'"],
    });
  });

  it('serializes next steps as MCP tool-call lines for MCP structured content', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [],
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '2', {
        nextSteps: [
          {
            tool: 'get_mac_app_path',
            cliTool: 'get-app-path',
            workflow: 'macos',
            label: 'Get app path',
            params: { scheme: 'MCPTest' },
          },
        ],
        nextStepRuntime: 'mcp',
      }),
    ).toMatchObject({
      nextSteps: ['Get app path: get_mac_app_path({ scheme: "MCPTest" })'],
    });
  });

  it('escapes MCP structured next-step string params as JSON string literals', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [],
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '2', {
        nextSteps: [
          {
            tool: 'launch_app_sim',
            cliTool: 'launch-app',
            workflow: 'simulator',
            label: 'Launch app',
            params: {
              scheme: 'Cam "Debug" App',
              bundleId: 'com.example.$APP\\debug',
              launchArg: 'line1\nline2',
            },
          },
        ],
        nextStepRuntime: 'mcp',
      }),
    ).toMatchObject({
      nextSteps: [
        'Launch app: launch_app_sim({ scheme: "Cam \\"Debug\\" App", bundleId: "com.example.$APP\\\\debug", launchArg: "line1\\nline2" })',
      ],
    });
  });

  it('preserves request data for normal structured output', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: false,
      error: null,
      request: {
        scheme: 'CalculatorApp',
        workspacePath: 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace',
      },
      summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
      artifacts: { buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log' },
      diagnostics: { warnings: [], errors: [] },
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.build-result', '2')).toEqual({
      schema: 'xcodebuildmcp.output.build-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        request: {
          scheme: 'CalculatorApp',
          workspacePath: 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace',
        },
        summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
        artifacts: { buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log' },
        diagnostics: { warnings: [], errors: [] },
      },
    });
  });

  it('preserves CLI next steps while applying minimal structured-output compactness', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: false,
      error: null,
      request: {
        scheme: 'CalculatorApp',
        workspacePath: 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace',
      },
      summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
      artifacts: { buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log' },
      diagnostics: { warnings: [], errors: [] },
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.build-result', '2', {
        nextSteps: [
          {
            tool: 'get_mac_app_path',
            cliTool: 'get-app-path',
            workflow: 'macos',
            label: 'Get built app path',
            params: { scheme: 'CalculatorApp' },
          },
        ],
        outputStyle: 'minimal',
      }),
    ).toEqual({
      schema: 'xcodebuildmcp.output.build-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
        artifacts: { buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log' },
        diagnostics: { warnings: [], errors: [] },
      },
      nextSteps: ['Get built app path: xcodebuildmcp macos get-app-path --scheme CalculatorApp'],
    });
  });

  it('uses null data when minimal pruning removes the only data field', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: false,
      error: null,
      request: { scheme: 'CalculatorApp' },
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.build-result', '2', {
        outputStyle: 'minimal',
      }),
    ).toEqual({
      schema: 'xcodebuildmcp.output.build-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: null,
    });
  });

  it('leaves minimal structured output without request frontmatter unchanged', () => {
    const result: StructuredOutputEnvelope<{ simulators: [] }> = {
      schema: 'xcodebuildmcp.output.simulator-list',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: { simulators: [] },
    };

    expect(
      toStructuredEnvelope(
        {
          kind: 'simulator-list',
          didError: result.didError,
          error: result.error,
          simulators: [],
        },
        result.schema,
        result.schemaVersion,
        { outputStyle: 'minimal' },
      ),
    ).toEqual(result);
  });

  it('serializes label-only next steps as text lines', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [],
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '2', {
        nextSteps: [
          {
            label: 'Open Simulator',
            params: {},
          },
        ],
      }),
    ).toMatchObject({
      nextSteps: ['Open Simulator'],
    });
  });
});
