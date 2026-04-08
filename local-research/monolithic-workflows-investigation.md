# Investigation: Monolithic Multi-Step Workflows in build_run_* Tools

## Summary

The claim is **valid but nuanced**. The three `build_run_*` orchestrators (`build_run_sim`, `build_run_device`, `build_run_macos`) are monolithic at the **orchestration layer** — each inlines the full workflow (build, resolve app path, boot/install/launch) in a single function. However, they already share significant **utility-level** infrastructure. The duplication is specifically between orchestrator inline logic and the corresponding standalone step-tool handlers, which implement the same commands independently.

## Symptoms

- `build_run_simLogic` is 549 lines, performing ~8 distinct steps inline
- `build_run_deviceLogic` is 357 lines, performing ~6 distinct steps inline
- `buildRunMacOSLogic` is 242 lines, performing ~5 distinct steps inline
- Each orchestrator duplicates command construction found in standalone step tools
- Step tools (`boot_sim`, `install_app_sim`, `launch_app_sim`, etc.) exist but are never called by orchestrators

## Investigation Log

### Phase 1 — Identifying the Orchestrators and Step Tools

**Hypothesis:** The build_run_* files contain monolithic handlers that duplicate step-tool logic.

**Findings:** Three orchestrators exist, each with corresponding standalone step tools:

| Orchestrator | Standalone Step Tools |
|---|---|
| `build_run_sim.ts` | `build_sim.ts`, `boot_sim.ts`, `install_app_sim.ts`, `launch_app_sim.ts`, `get_sim_app_path.ts` |
| `build_run_device.ts` | `build_device.ts`, `install_app_device.ts`, `launch_app_device.ts`, `get_device_app_path.ts` |
| `build_run_macos.ts` | `build_macos.ts`, `launch_mac_app.ts`, `get_mac_app_path.ts` |

**Conclusion:** Confirmed — orchestrators and step tools are fully independent modules with no handler-level composition.

### Phase 2 — Concrete Duplication: Simulator Boot

**Hypothesis:** Boot logic is duplicated between `build_run_sim.ts` and `boot_sim.ts`.

**Evidence:**

`boot_sim.ts` line 57:
```typescript
const command = ['xcrun', 'simctl', 'boot', params.simulatorId];
const result = await executor(command, 'Boot Simulator', false);
```

`build_run_sim.ts` lines 283-288 (inline in the orchestrator):
```typescript
const bootResult = await executor(
  ['xcrun', 'simctl', 'boot', simulatorId],
  'Boot Simulator',
);
```

Additionally, `build_run_sim.ts` lines 246-280 contains ~35 lines of simulator state checking logic (JSON parsing of `simctl list devices available --json`, iterating runtimes to find the target simulator by UUID, checking `state !== 'Booted'`) that has no equivalent in `boot_sim.ts` — the standalone tool assumes the caller knows the simulator needs booting.

**Conclusion:** Confirmed duplication. The orchestrator also has **extra logic** not in the step tool (state checking before boot).

### Phase 3 — Concrete Duplication: Simulator Install

**Hypothesis:** Install logic is duplicated.

**Evidence:**

`install_app_sim.ts` line 73:
```typescript
const command = ['xcrun', 'simctl', 'install', params.simulatorId, params.appPath];
const result = await executor(command, 'Install App in Simulator', false);
```

`build_run_sim.ts` lines 316-319 (inline):
```typescript
const installResult = await executor(
  ['xcrun', 'simctl', 'install', simulatorId, appBundlePath],
  'Install App',
);
```

**Conclusion:** Confirmed — identical command, duplicated in both places.

### Phase 4 — Concrete Duplication: Simulator Launch

**Evidence:**

`launch_app_sim.ts` lines 103-104:
```typescript
const command = ['xcrun', 'simctl', 'launch', simulatorId, params.bundleId];
```
Plus PID parsing at lines 113-114:
```typescript
const pidMatch = result.output?.match(/:\s*(\d+)\s*$/);
```

`build_run_sim.ts` lines 355-358:
```typescript
const launchResult = await executor(
  ['xcrun', 'simctl', 'launch', simulatorId, bundleId],
  'Launch App',
);
```
Plus PID parsing at lines 362-363:
```typescript
const pidMatch = launchResult.output?.match(/:\s*(\d+)\s*$/);
```

**Conclusion:** Confirmed — identical command and PID regex, duplicated.

### Phase 5 — Concrete Duplication: Device Install

**Evidence:**

`install_app_device.ts` line 53:
```typescript
['xcrun', 'devicectl', 'device', 'install', 'app', '--device', deviceId, appPath]
```

`build_run_device.ts` line 203:
```typescript
['xcrun', 'devicectl', 'device', 'install', 'app', '--device', params.deviceId, appPath]
```

**Conclusion:** Confirmed — identical command.

### Phase 6 — Concrete Duplication: Device Launch (Heaviest Duplication)

**Evidence:**

`launch_app_device.ts` lines 80-95:
```typescript
const tempJsonPath = join(fileSystem.tmpdir(), `launch-${Date.now()}.json`);
const command = [
  'xcrun', 'devicectl', 'device', 'process', 'launch',
  '--device', deviceId,
  '--json-output', tempJsonPath,
  '--terminate-existing',
];
if (params.env && Object.keys(params.env).length > 0) {
  command.push('--environment-variables', JSON.stringify(params.env));
}
command.push(bundleId);
```
Plus JSON PID parsing at lines 104-112 and temp file cleanup at lines 113-115.

`build_run_device.ts` lines 223-244:
```typescript
const tempJsonPath = join(fileSystemExecutor.tmpdir(), `launch-${Date.now()}.json`);
const command = [
  'xcrun', 'devicectl', 'device', 'process', 'launch',
  '--device', params.deviceId,
  '--json-output', tempJsonPath,
  '--terminate-existing',
];
if (params.env && Object.keys(params.env).length > 0) {
  command.push('--environment-variables', JSON.stringify(params.env));
}
command.push(bundleId);
```
Plus near-identical JSON PID parsing at lines 250-259 and cleanup at lines 260-262.

**Conclusion:** Confirmed — this is the clearest case of near-verbatim duplication (~40 lines of identical logic).

### Phase 7 — Concrete Duplication: macOS Launch

**Evidence:**

`launch_mac_app.ts` lines 43-68:
```typescript
const command = ['open', params.appPath];
// ... launch ...
// Bundle ID extraction via defaults read
const plistResult = await executor(
  ['/bin/sh', '-c', `defaults read "${params.appPath}/Contents/Info" CFBundleIdentifier`],
  'Extract Bundle ID', false,
);
// PID lookup via pgrep
const pgrepResult = await executor(['pgrep', '-x', appName], 'Get Process ID', false);
```

`build_run_macos.ts` lines 160-195:
```typescript
const launchResult = await executor(['open', appPath], 'Launch macOS App', false);
// ... same bundle ID extraction ...
const plistResult = await executor(
  ['/bin/sh', '-c', `defaults read "${appPath}/Contents/Info" CFBundleIdentifier`],
  'Extract Bundle ID', false,
);
// ... same pgrep PID lookup ...
const pgrepResult = await executor(['pgrep', '-x', appName], 'Get Process ID', false);
```

**Conclusion:** Confirmed — same three-step pattern (open, defaults read, pgrep) duplicated.

### Phase 8 — Existing Good Pattern: `handleTestLogic`

The test tools (`test_sim.ts`, `test_device.ts`, `test_macos.ts`) demonstrate the better pattern already present in the codebase.

`test_sim.ts` line 139:
```typescript
return handleTestLogic({ ...params, platform: inferred.platform }, executor, {
  preflight: preflight ?? undefined,
  toolName: 'test_sim',
});
```

`handleTestLogic` lives in `src/utils/test-common.ts` (exported via `src/utils/test/index.ts`) and is shared across all three test tool handlers. Each tool does thin validation/platform inference, then delegates to the shared logic.

**Conclusion:** The codebase already has a proven pattern for shared workflow logic. The build-run tools haven't adopted it yet.

## What Is NOT Duplicated (Shared Utilities)

To be fair, the orchestrators already share significant infrastructure:

- `executeXcodeBuildCommand` — build command construction and execution
- `resolveAppPathFromBuildSettings` — app path resolution from xcodebuild settings
- `startBuildPipeline` / `createPendingXcodebuildResponse` — pipeline lifecycle
- `createBuildRunResultEvents` / `emitPipelineNotice` / `emitPipelineError` — structured events
- `extractBundleIdFromAppPath` — bundle ID extraction
- `inferPlatform` — simulator platform inference
- `determineSimulatorUuid` — simulator UUID resolution

The duplication is specifically at the **step execution layer**: boot, install, launch commands and their response handling.

## Root Cause

The orchestrators were written as self-contained end-to-end workflows. The step tools were written as separate user-facing handlers. Neither calls the other. Both construct the same underlying commands independently.

This is a classic "convenience wrapper vs granular API" problem — the orchestrators were likely written first (or in parallel) without extracting the step logic into reusable internal primitives.

## Recommendations

### Recommended Approach: Extract Internal Step Primitives

Create pure internal helper functions (not tool handlers) that encapsulate each step's command construction, execution, and result parsing. Both orchestrators and step tools would then call these.

**1. Simulator steps** — new file `src/utils/simulator-steps.ts`:
```typescript
export async function bootSimulatorIfNeeded(simulatorId: string, executor: CommandExecutor): Promise<StepResult>
export async function installAppOnSimulator(simulatorId: string, appPath: string, executor: CommandExecutor): Promise<StepResult>
export async function launchSimulatorApp(simulatorId: string, bundleId: string, executor: CommandExecutor): Promise<LaunchResult>
```

**2. Device steps** — new file `src/utils/device-steps.ts`:
```typescript
export async function installAppOnDevice(deviceId: string, appPath: string, executor: CommandExecutor): Promise<StepResult>
export async function launchAppOnDevice(deviceId: string, bundleId: string, env?: Record<string,string>, fs?: FileSystemExecutor): Promise<LaunchResult>
```

**3. macOS steps** — new file `src/utils/macos-steps.ts`:
```typescript
export async function launchMacApp(appPath: string, args?: string[], executor: CommandExecutor): Promise<LaunchResult>
```

Then refactor:
- `build_run_sim.ts` → calls `bootSimulatorIfNeeded()`, `installAppOnSimulator()`, `launchSimulatorApp()`
- `boot_sim.ts` → calls `bootSimulatorIfNeeded()` (or just `bootSimulator()`)
- `install_app_sim.ts` → calls `installAppOnSimulator()`
- `launch_app_sim.ts` → calls `launchSimulatorApp()`
- Same pattern for device and macOS tools

### Why NOT "Tool Calls Tool"

The tool handlers mix validation, session-default handling, response formatting, and next-step metadata. Making orchestrators call step-tool handlers would be clumsy because:
- Tool handlers return `ToolResponse` with formatted events — the orchestrator would need to unwrap and re-wrap
- Schema validation would run redundantly
- Error handling and pipeline eventing would conflict

Internal primitives that return simple result types are the clean separation.

### Alternative: `handleBuildRunLogic` (Like `handleTestLogic`)

A more aggressive refactor would extract a single `handleBuildRunLogic` shared function (analogous to `handleTestLogic` for tests) that all three orchestrators delegate to. This would require parameterizing the platform-specific steps (boot/install/launch) but could eliminate even more duplication in the build → resolve-path → run pipeline.

## Preventive Measures

- When adding new multi-step workflow tools, extract step logic into `src/utils/*-steps.ts` first, then compose in both the orchestrator and the individual step-tool handlers
- Consider adding a lint rule or code review checklist item: "Does this tool duplicate command logic from another tool?"
- The `handleTestLogic` pattern is the gold standard in this codebase — reference it when designing new shared workflows

## Estimated Impact

| File | Current Lines | Estimated Reduction |
|---|---|---|
| `build_run_sim.ts` | 549 | ~120-150 lines (boot/install/launch/state-check blocks) |
| `build_run_device.ts` | 357 | ~60-80 lines (install/launch blocks) |
| `build_run_macos.ts` | 242 | ~30-40 lines (launch/bundleid/pid blocks) |
| Step tools (6 files) | ~705 total | ~50-80 lines (delegating to shared primitives) |

Total: ~260-350 lines of duplicated logic consolidated into ~100-150 lines of shared step primitives.
