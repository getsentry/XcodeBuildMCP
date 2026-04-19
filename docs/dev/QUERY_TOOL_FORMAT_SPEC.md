# Query Tool Formatting Spec

## Goal

Make all xcodebuild query tools (list-schemes, show-build-settings, get-app-path variants) use the same visual UX as pipeline-backed build/test tools: front matter, structured errors, clean results, manifest-driven next steps.

These tools do NOT need the full streaming pipeline (no parser, no run-state, no renderers). They run a single short-lived xcodebuild command and return a result. But they must share the same visual language.

## Target output format

### Happy path

```
🔍 List Schemes

  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace

Schemes:
  - CalculatorApp
  - CalculatorAppFeature

Next steps:
1. Build for simulator: xcodebuildmcp simulator build ...
```

```
🔍 Show Build Settings

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace

<build settings output>

Next steps:
1. Build for macOS: ...
```

```
🔍 Get App Path

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Platform: iOS Simulator
  Simulator: iPhone 17

  └ App Path: /path/to/CalculatorApp.app

Next steps:
1. Get bundle ID: ...
```

### Sad path

```
🔍 Get App Path

  Scheme: NONEXISTENT
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Platform: iOS Simulator

Errors (1):

  ✗ The workspace named "CalculatorApp" does not contain a scheme named "NONEXISTENT".

❌ Query failed.
```

No raw xcodebuild noise (timestamps, PIDs, result bundle paths). No next steps on failure.

## Implementation approach

### Shared helper: `formatQueryPreflight`

Extend `formatToolPreflight` in `src/utils/build-preflight.ts` to support query operations. Add operation types: `'List Schemes'`, `'Show Build Settings'`, `'Get App Path'`. Make `configuration` and `platform` optional (query tools may not have them).

Use emoji `🔍` (U+1F50D) for all query operations.

### Shared helper: `parseXcodebuildError`

Create a small utility to extract clean error messages from raw xcodebuild stderr/output. Strip:
- Timestamp lines (`2026-03-21 13:42:...`)
- Result bundle lines (`Writing error result bundle to ...`)
- PID noise

Keep only `xcodebuild: error: <message>` lines, cleaned to just `<message>`.

### Error formatting

Use the same `Errors (N):` grouped block format with `✗` prefix. Reuse `formatGroupedCompilerErrors` or a lightweight equivalent.

### Result formatting

- `list_schemes`: List schemes as `  - SchemeName` lines under a `Schemes:` heading
- `show_build_settings`: Raw build settings output (already structured)
- `get_*_app_path`: Use the tree format (`└ App Path: /path/to/app`) matching the build-run-result footer

### Next steps

Continue using `nextStepParams` and let `postProcessToolResponse` resolve manifest templates. No change needed.

### Error response

On failure, return `isError: true` with no next steps (consistent with pipeline tools).

## Tools to migrate

1. `src/mcp/tools/project-discovery/list_schemes.ts`
2. `src/mcp/tools/project-discovery/show_build_settings.ts`
3. `src/mcp/tools/simulator/get_sim_app_path.ts`
4. `src/mcp/tools/macos/get_mac_app_path.ts`
5. `src/mcp/tools/device/get_device_app_path.ts`

## Rules

- No full pipeline (no startBuildPipeline, no createPendingXcodebuildResponse)
- Use formatToolPreflight (extended) for front matter
- Parse xcodebuild errors cleanly
- Strip raw xcodebuild noise from error output
- Use `✗` grouped error block for failures
- Use `❌ Query failed.` as the failure summary (not tool-specific messages)
- Next steps only on success
- Update existing tests to match new output format
- All tests must pass, no regressions
