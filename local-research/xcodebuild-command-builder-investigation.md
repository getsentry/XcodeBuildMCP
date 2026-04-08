# Investigation: XcodebuildCommandBuilder Claim

## Summary

The claim that "xcodebuild command construction argument building is scattered across tools" and that "a XcodebuildCommandBuilder with a fluent API would centralize this" is **partially true but overstated**. The core build/test path is already well centralized via `executeXcodeBuildCommand`. The real duplication is limited to a few `-showBuildSettings` query tools. A fluent builder would be over-engineering — targeted consolidation of the `get_*_app_path` tools is the right fix.

## Symptoms Under Investigation

- Claim: xcodebuild argument building is scattered across tools
- Claim: A XcodebuildCommandBuilder with a fluent API would centralize this

## Investigation Log

### Phase 1 — Quantifying the Scope

**Hypothesis:** xcodebuild command construction exists in many files across the codebase.

**Findings:** 456 matches for "xcodebuild" across `src/` (excluding tests). However, many are imports, log messages, and type references — not command construction.

**Actual command construction sites (files that build `xcodebuild` argument arrays):**

| File | Command Type | Centralized? |
|------|-------------|--------------|
| `src/utils/build-utils.ts:82-171` | build/test/build-for-testing/test-without-building | Yes — this IS the center |
| `src/utils/app-path-resolver.ts:63-93` | -showBuildSettings (app path lookup) | Yes — secondary center |
| `src/mcp/tools/simulator/get_sim_app_path.ts:143-156` | -showBuildSettings | No — inline duplicate |
| `src/mcp/tools/device/get_device_app_path.ts:102-116` | -showBuildSettings | No — inline duplicate |
| `src/mcp/tools/macos/get_mac_app_path.ts:94-112` | -showBuildSettings | No — inline duplicate |
| `src/mcp/tools/utilities/clean.ts:127-153` | clean action | No — inline (partially justified) |
| `src/mcp/tools/project-discovery/list_schemes.ts:52-55` | -list | No — inline (justified) |
| `src/mcp/tools/project-discovery/show_build_settings.ts:69-74` | -showBuildSettings | No — inline (justified) |
| `src/utils/platform-detection.ts:63-79` | -showBuildSettings (platform inference) | No — inline (justified) |
| `src/utils/xcode-state-watcher.ts:53-60` | -showBuildSettings -skipPackageUpdates | No — inline (justified) |
| `src/utils/sentry.ts` | -version | Peripheral diagnostic |
| `src/mcp/tools/doctor/lib/doctor.deps.ts:152` | -version | Peripheral diagnostic |

**Conclusion:** 12 sites total. 2 are centralized. 3 are clear duplicates. 5 are local-but-justified. 2 are peripheral.

### Phase 2 — Evaluating Existing Centralization

**Hypothesis:** `executeXcodeBuildCommand` already centralizes the most important path.

**Evidence:**

`executeXcodeBuildCommand` (build-utils.ts:29-261) handles:
- Project/workspace selection with path resolution (lines 82-92)
- Scheme, configuration, `-skipMacroValidation` (lines 94-96)
- Full destination logic for all platforms: simulator by ID/name, macOS with arch, device by ID, generic (lines 98-134)
- Test-specific flags: `COMPILER_INDEX_STORE_ENABLE`, `ONLY_ACTIVE_ARCH`, `-packageCachePath` (lines 141-149)
- derivedDataPath, extraArgs (lines 151-157)
- Build action appended last (line 159)
- xcodemake fallback logic (lines 162-190)
- cwd set to project directory (line 194)

**Callers (6 build/test tools) do NO argument construction** — they pass `SharedBuildParams` + `PlatformBuildOptions` objects and `executeXcodeBuildCommand` handles everything. Example from `build_sim.ts`:

```typescript
const sharedBuildParams = { ...params, configuration };
const platformOptions = { platform: detectedPlatform, simulatorName, simulatorId, useLatestOS, logPrefix };
const buildResult = await executeXcodeBuildCommand(sharedBuildParams, platformOptions, ...);
```

**Conclusion: Confirmed.** The highest-volume, most important xcodebuild construction path is already centralized correctly.

`resolveAppPathFromBuildSettings` (app-path-resolver.ts:60-100) is a secondary center for `-showBuildSettings` queries used by build-run flows. It handles project/workspace, scheme, config, destination, derivedDataPath, extraArgs, cwd — essentially the same shared arg pattern.

### Phase 3 — The Real Duplication: `get_*_app_path` Tools

**Hypothesis:** The three `get_*_app_path` tools duplicate `resolveAppPathFromBuildSettings`.

**Evidence — behavioral drift across the three tools:**

| Behavior | `get_sim_app_path.ts` | `get_device_app_path.ts` | `get_mac_app_path.ts` | `resolveAppPathFromBuildSettings` |
|----------|----------------------|-------------------------|-----------------------|----------------------------------|
| Resolves paths to absolute | No | Yes (line 103-106) | No | Yes |
| Sets cwd | No | Yes (line 118-121) | No | Yes |
| Always adds -destination | Yes | Yes | Only when arch provided | Yes |
| Handles derivedDataPath | No | No | Yes (line 104-106) | Yes |
| Handles extraArgs | No | No | Yes (line 108-110) | Yes |

This drift is the strongest evidence that the duplication is harmful — the tools have silently diverged in path resolution and cwd handling. `get_sim_app_path.ts` doesn't resolve relative paths or set cwd, while `get_device_app_path.ts` does. This is almost certainly unintentional.

All three could delegate to `resolveAppPathFromBuildSettings` (or a slightly extended version) instead of inline construction.

### Phase 4 — Adjacent Duplication: `clean.ts`

**Hypothesis:** `clean.ts` duplicates `executeXcodeBuildCommand`.

**Evidence:** `clean.ts` (lines 127-153) builds:
- project/workspace with path resolution
- scheme, configuration
- destination via `constructDestinationString`
- derivedDataPath, extraArgs
- `clean` action

This overlaps ~80% with `executeXcodeBuildCommand`. However, `executeXcodeBuildCommand` includes xcodemake logic, test-specific flags, and build pipeline integration that `clean` should NOT inherit.

**Notable issue:** `clean.ts` line 115: `const scheme = params.scheme ?? '';` followed by `command.push('-scheme', scheme)` — this can emit `-scheme ""` which is suboptimal. A shared helper would prevent this kind of drift.

**Conclusion:** Merging into `executeXcodeBuildCommand` would be wrong. But extracting a small shared helper for the common "resolve paths + append project/workspace/scheme/config/destination/derivedData/extraArgs" pattern would reduce this risk.

### Phase 5 — Intentionally Local Builders

**Hypothesis:** Discovery/inspection commands are local for good reasons.

**Evidence:**
- `list_schemes.ts`: Only needs `-list` + project/workspace (2 args). Minimal surface.
- `show_build_settings.ts`: Only needs `-showBuildSettings` + project/workspace + scheme (3 args). Minimal surface.
- `platform-detection.ts`: Needs `-showBuildSettings -scheme` + project/workspace, but arg ORDER differs (scheme before project). Intentional for specific parsing needs.
- `xcode-state-watcher.ts`: Needs `-showBuildSettings -scheme -skipPackageUpdates` + optional project/workspace. The `-skipPackageUpdates` is unique to this use case.

**Conclusion:** These are different enough in semantics that forcing them through a universal builder would add complexity without reducing bugs. The shared surface (project/workspace toggle) is 2-4 lines — not worth abstracting.

## Root Cause Analysis

The claim is **partially valid but the proposed solution is wrong**.

**What's true:**
- 3 `get_*_app_path` tools duplicate `-showBuildSettings` arg construction that already exists in `resolveAppPathFromBuildSettings`
- This duplication has caused behavioral drift (path resolution, cwd handling)
- `clean.ts` shares ~80% of its arg construction with `executeXcodeBuildCommand`

**What's overstated:**
- The core build/test path (6 callers) is already centralized in `executeXcodeBuildCommand`
- Discovery/inspection tools are intentionally local with minimal shared surface
- Peripheral `-version` checks are trivial

**What's wrong about the proposed fix:**
- A `XcodebuildCommandBuilder` with a fluent API would need to handle: build, test, build-for-testing, test-without-building, clean, -showBuildSettings, -list, -version, xcodemake fallback, test-specific flags, pipeline integration — all of which have different requirements
- This would create a god-object that's harder to understand than the current focused abstractions
- The current architecture of `executeXcodeBuildCommand` (action center) + `resolveAppPathFromBuildSettings` (query center) is a better decomposition

## Recommendations

### 1. Consolidate `get_*_app_path` tools onto `resolveAppPathFromBuildSettings` (HIGH VALUE)
- `get_sim_app_path.ts`, `get_device_app_path.ts`, `get_mac_app_path.ts` should delegate command construction to `resolveAppPathFromBuildSettings` or a slight extension of it
- This fixes the behavioral drift (path resolution, cwd) and removes ~60 lines of duplicated arg construction
- May need to extend `resolveAppPathFromBuildSettings` to support simulator destination strings (currently only handles generic/device destinations)

### 2. Optionally extract a tiny shared helper for common args (LOW-MEDIUM VALUE)
A small function like:
```typescript
function resolveXcodebuildPaths(params: { projectPath?: string; workspacePath?: string }) {
  // resolve to absolute, return { projectPath, workspacePath, projectDir }
}
```
This could be reused by `clean.ts` and `resolveAppPathFromBuildSettings` to reduce the path resolution duplication. But this is minor — only worth doing if you're already touching these files.

### 3. Do NOT build a XcodebuildCommandBuilder (RECOMMENDATION: SKIP)
- The current architecture is already well-decomposed
- A fluent builder would be over-engineering for the actual duplication that exists
- The fix is consolidation of 3 tools onto an existing abstraction, not a new abstraction

## Preventive Measures

- When adding new tools that run `xcodebuild -showBuildSettings`, check if `resolveAppPathFromBuildSettings` can be reused first
- The existing `SharedBuildParams` + `PlatformBuildOptions` type pattern works well — continue using it for new build actions
