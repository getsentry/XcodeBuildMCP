# Unified tool output pipeline

## Goal

Every tool in XcodeBuildMCP must produce its output through a single structured pipeline. No tool may construct its own formatted text. The pipeline owns all rendering, spacing, path formatting, and section structure.

This applies to:

- xcodebuild-backed tools (build, test, build & run, clean)
- query tools (list simulators, list schemes, discover projects, show build settings)
- action tools (set appearance, set location, boot simulator, install app)
- coverage tools (coverage report, file coverage)
- scaffolding tools (scaffold iOS project, scaffold macOS project)
- logging tools (start/stop log capture)
- debugging tools (attach, breakpoints, variables)
- UI automation tools (tap, swipe, type text, screenshot, snapshot UI)
- session tools (set defaults, show defaults, clear defaults)

No exceptions. If a tool produces user-visible output, it goes through the pipeline.

## Architecture principle

Shared formatting, runtime-specific renderers.

All renderers share a single set of formatting functions (`event-formatting.ts`) that define how each event type is converted to text. This is the single source of truth for output formatting. Each runtime has its own renderer that orchestrates those shared formatters according to its needs:

- **MCP renderer** (`mcp-renderer.ts`): Buffers formatted text and returns it in `ToolResponse.content`. Applies session-level warning suppression.
- **CLI text renderer** (`cli-text-renderer.ts`): Writes formatted text to stdout as events arrive. In interactive TTY mode, uses a Clack spinner for transient status updates (build stages, progress). Manages durable vs transient line state.
- **CLI JSONL renderer** (`cli-jsonl-renderer.ts`): Serialises each event as one JSON line to stdout. Does not go through the text formatters.

The renderers are not "dumb pipes" — the CLI text renderer in particular is a state machine that tracks transient lines, flush timing, and interactive spinner state. This is why the architecture uses separate renderer implementations rather than a single renderer with sink adapters.

The key invariant is: **all text formatting lives in `event-formatting.ts`**. Renderers orchestrate when and how those formatters are called, but no renderer contains its own formatting logic.

Runtime-specific rendering concerns:

- CLI interactive mode: Clack spinner for transient status updates, durable flush rules before summary events
- Next steps syntax: CLI renders `xcodebuildmcp workflow tool --flag "value"`, MCP renders `tool_name({ param: "value" })`. This is a single parameterised formatting function.
- Warning suppression: session-level filter applied in MCP renderer before rendering.

## Why this matters

Without a unified pipeline, every tool re-invents:

- spacing between sections (some add blank lines, some don't)
- file path formatting (some call `displayPath`, some don't)
- header/preflight structure (some use `formatToolPreflight`, some build strings manually)
- error formatting (some use icons, some use `[NOT COVERED]`, some use bare text)
- next steps rendering (some hardcode strings, some use the manifest)

Every new tool or refactor re-introduces the same bugs. The pipeline makes these bugs structurally impossible.

## Event model

All tools emit structured events. The renderer converts events to formatted text. Tools never produce formatted text directly.

### Generic tool events

These events cover all non-xcodebuild tools:

```ts
type ToolEvent =
  | HeaderEvent        // preflight block: operation name + params
  | SectionEvent       // titled group of content lines
  | DetailTreeEvent    // key/value pairs with tree connectors
  | StatusLineEvent    // single status message (success, error, info)
  | FileRefEvent       // a file path (always normalised)
  | TableEvent         // rows of structured data
  | SummaryEvent       // final outcome line
  | NextStepsEvent     // suggested follow-up actions
  | XcodebuildEvent;   // existing xcodebuild events (unchanged)
```

#### HeaderEvent

Replaces `formatToolPreflight`. Every tool starts with a header.

```ts
interface HeaderEvent {
  type: 'header';
  operation: string;      // e.g. 'File Coverage', 'List Simulators', 'Set Appearance'
  params: Array<{         // rendered as indented key: value lines
    label: string;
    value: string;
  }>;
  timestamp: string;
}
```

The renderer owns:

- the emoji (looked up from the operation name)
- the blank line after the heading
- the indentation of params
- the trailing blank line after the params block

Tools cannot get the spacing wrong because they never produce it.

#### SectionEvent

A titled group of content lines with an optional icon.

```ts
interface SectionEvent {
  type: 'section';
  title: string;          // e.g. 'Not Covered (7 functions, 22 lines)'
  icon?: 'red-circle' | 'yellow-circle' | 'green-circle' | 'checkmark' | 'cross' | 'info';
  lines: string[];        // indented content lines
  timestamp: string;
}
```

The renderer owns:

- the icon-to-emoji mapping
- the blank line before and after each section
- the indentation of content lines

#### DetailTreeEvent

Key/value pairs rendered with tree connectors.

```ts
interface DetailTreeEvent {
  type: 'detail-tree';
  items: Array<{ label: string; value: string }>;
  timestamp: string;
}
```

Rendered as:

```text
  ├ App Path: /path/to/app
  └ Bundle ID: com.example.app
```

The renderer owns the connector characters and indentation.

#### StatusLineEvent

A single status message.

```ts
interface StatusLineEvent {
  type: 'status-line';
  level: 'success' | 'error' | 'info' | 'warning';
  message: string;
  timestamp: string;
}
```

The renderer owns the emoji prefix based on level.

#### FileRefEvent

A file path that must be normalised.

```ts
interface FileRefEvent {
  type: 'file-ref';
  label?: string;         // e.g. 'File' — rendered as "File: <path>"
  path: string;           // raw absolute path from the tool
  timestamp: string;
}
```

The renderer always runs the path through `displayPath()` (relative if under cwd, absolute otherwise). Tools cannot bypass this.

#### TableEvent

Rows of structured data grouped under an optional heading.

```ts
interface TableEvent {
  type: 'table';
  heading?: string;       // e.g. 'iOS 18.5'
  columns: string[];      // column names for alignment
  rows: Array<Record<string, string>>;
  timestamp: string;
}
```

The renderer owns column alignment and indentation.

#### SummaryEvent (generic)

A final outcome line for non-xcodebuild tools. Different from the xcodebuild `SummaryEvent` which includes test counts and duration.

```ts
interface GenericSummaryEvent {
  type: 'generic-summary';
  level: 'success' | 'error';
  message: string;
  timestamp: string;
}
```

#### NextStepsEvent

Unchanged from the existing model. Parameterised rendering for CLI vs MCP syntax.

### Xcodebuild events

The existing `XcodebuildEvent` union type is unchanged. Xcodebuild-backed tools continue to use:

- `start` (replaces `HeaderEvent` for xcodebuild tools — the start event already contains the preflight)
- `status`, `warning`, `error`, `notice`
- `test-discovery`, `test-progress`, `test-failure`
- `summary`
- `next-steps`

The xcodebuild event parser feeds these into the same pipeline. The renderer handles both generic tool events and xcodebuild events.

## Pipeline architecture

### For xcodebuild-backed tools (existing, unchanged)

```text
tool logic
  -> startBuildPipeline(...)
  -> XcodebuildPipeline
  -> parser + run-state
  -> ordered XcodebuildEvent stream
  -> renderer -> sink (stdout or buffer)
```

This path remains as-is. The xcodebuild parser, run-state layer, and event types do not change.

### For all other tools (new)

```text
tool logic
  -> emits ToolEvent[] (or streams them)
  -> renderer -> sink (stdout or buffer)
```

Simple tools emit events synchronously and return them. The pipeline renders them and routes to the appropriate sink.

There is no parser or run-state layer for non-xcodebuild tools. They don't need one — they already have structured data. The pipeline is just: structured events -> renderer -> sink.

### Mermaid diagram

```mermaid
flowchart LR
    subgraph "Xcodebuild tools"
        A[Tool logic] --> B[XcodebuildPipeline]
        B --> C[Event parser]
        B --> D[Run-state]
        C --> D
        D --> E[PipelineEvent stream]
    end

    subgraph "All other tools"
        F[Tool logic] --> G[PipelineEvent array]
    end

    E --> H[resolveRenderers]
    G --> I[toolResponse] --> H

    H --> J[MCP renderer]
    H --> K{CLI mode?}

    J --> L[Buffer → ToolResponse.content]

    K -->|text| M[CLI text renderer]
    K -->|json| N[CLI JSONL renderer]

    M --> O[stdout - streaming text]
    N --> P[stdout - streaming JSON]

    subgraph "Shared formatting"
        Q[event-formatting.ts]
    end

    J -.-> Q
    M -.-> Q
```

### Renderer behaviour

#### MCP renderer

- Buffers all formatted text parts
- Returns as `ToolResponse.content` when the tool completes
- Applies session-level warning suppression
- Groups compiler errors, warnings, and test failures for batch rendering before summary

#### CLI text renderer

- Writes formatted text to stdout as events arrive
- In interactive TTY mode: uses Clack spinner for transient status events, tracks durable vs transient line state
- In non-interactive mode: writes all events as durable lines
- Groups compiler errors, warnings, and test failures for batch rendering before summary
- Tracks `lastVisibleEventType` for compact spacing between consecutive status lines

#### CLI JSONL renderer

- Serialises each event as one JSON line to stdout
- Does not go through the text formatters
- Available for all tools (events are the same union type)

### Renderer resolution

`resolveRenderers()` in `src/utils/renderers/index.ts` always creates the MCP renderer (for `ToolResponse.content`). If running in CLI mode, it also creates either the CLI text renderer or CLI JSONL renderer based on output format.

`toolResponse()` in `src/utils/tool-response.ts` feeds events through all active renderers and extracts content from the MCP renderer.

## Formatting contract

One set of formatting functions. All renderers.

```ts
// src/utils/renderers/event-formatting.ts
formatHeaderEvent(event: HeaderEvent): string;
formatBuildStageEvent(event: BuildStageEvent): string;
formatStatusLineEvent(event: StatusLineEvent): string;
formatSectionEvent(event: SectionEvent): string;
formatDetailTreeEvent(event: DetailTreeEvent): string;
formatTableEvent(event: TableEvent): string;
formatFileRefEvent(event: FileRefEvent): string;
formatSummaryEvent(event: SummaryEvent): string;
formatNextStepsEvent(event: NextStepsEvent, runtime: 'cli' | 'mcp'): string;
```

The formatting layer is the single source of truth for:

- emoji selection per operation/level/icon
- spacing between sections (always one blank line)
- file path normalisation (always `displayPath()`)
- indentation depth (always 2 spaces for params, content lines)
- tree connector characters
- next steps formatting (parameterised by runtime)
- section ordering enforcement

### Formatting rules enforced by the renderer

These rules are not guidelines. They are enforced structurally because tools cannot produce formatted text.

1. **Header always has a trailing blank line.** The renderer emits: blank line, emoji + operation, blank line, indented params, blank line. Every tool. No exceptions.

2. **File paths are always normalised.** `FileRefEvent` paths always go through `displayPath()`. Xcodebuild diagnostic paths go through `formatDiagnosticFilePath()`. There is no code path where a raw absolute path reaches the output.

3. **Sections are always separated by blank lines.** The renderer adds one blank line before each section. Tools cannot omit or double this.

4. **Icons are always consistent.** The renderer maps `icon` enum values to emoji. Tools do not contain emoji characters.

5. **Next steps are always last.** The renderer enforces ordering. Nothing renders after next steps.

6. **Error messages follow the convention.** `Failed to <action>: <detail>`. The renderer does not enforce this (it's a content concern), but the pipeline API makes it easy to follow.

## How tools emit events

### Simple action tools (e.g. set appearance)

```ts
return toolResponse([
  header('Set Appearance', [
    { label: 'Simulator', value: simulatorId },
  ]),
  statusLine('success', `Appearance set to ${mode} mode`),
]);
```

### Query tools (e.g. list simulators)

```ts
return toolResponse([
  header('List Simulators'),
  ...grouped.map(([runtime, devices]) =>
    table(runtime, ['Name', 'UUID', 'State'],
      devices.map(d => ({ Name: d.name, UUID: d.udid, State: d.state }))
    )
  ),
  nextSteps([...]),
]);
```

### Coverage tools (e.g. file coverage)

```ts
return toolResponse([
  header('File Coverage', [
    { label: 'xcresult', value: xcresultPath },
    { label: 'File', value: file },
  ]),
  fileRef('File', entry.filePath),
  statusLine('info', `Coverage: ${pct}% (${covered}/${total} lines)`),
  section('Not Covered', notCoveredLines, { icon: 'red-circle',
    title: `Not Covered (${count} functions, ${missedLines} lines)` }),
  section('Partial Coverage', partialLines, { icon: 'yellow-circle',
    title: `Partial Coverage (${count} functions)` }),
  section('Full Coverage', [`${fullCount} functions — all at 100%`], { icon: 'green-circle',
    title: `Full Coverage (${fullCount} functions) — all at 100%` }),
  nextSteps([...]),
]);
```

### Xcodebuild tools

These keep the existing parser and run-state layers (`startBuildPipeline()`, `executeXcodeBuildCommand()`, `createPendingXcodebuildResponse()`), but the run-state output gets mapped to `ToolEvent` types before reaching the renderer. The xcodebuild parser remains an ingestion layer — it just feeds into the unified event model instead of having its own rendering path. Streaming and Clack progress are preserved as CLI sink concerns.

## Locked human-readable output contract

The output structure for all tools follows the same rhythm:

```text
<emoji> <Operation Name>

  <Param>: <value>
  <Param>: <value>

<body sections — varies by tool>

<summary or status line>

<execution-derived footer — if applicable>

Next steps:
1. <step>
2. <step>
```

### For xcodebuild-backed tools

The canonical examples are `build_run_macos` and `build_run_sim`. Their output contract is locked:

Successful runs:

1. front matter (header event / start event)
2. runtime state and durable diagnostics
3. summary
4. execution-derived footer (detail tree)
5. next steps

Failed runs:

1. front matter
2. runtime state and/or grouped diagnostics
3. summary

Failed runs do not render next steps.

### For non-xcodebuild tools

Successful runs:

1. header
2. body (sections, tables, file refs, status lines — tool-specific)
3. next steps (if applicable)

Failed runs:

1. header
2. error status line
3. no next steps

### Example outputs

#### Build (xcodebuild pipeline — existing)

```text
🔨 Build

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator
  Simulator: iPhone 17

✅ Build succeeded. (⏱️ 12.3s)

Next steps:
1. Get built app path: xcodebuildmcp simulator get-app-path --scheme "CalculatorApp"
```

#### File Coverage (generic pipeline — new)

```text
📊 File Coverage

  xcresult: /tmp/TestResults.xcresult
  File: CalculatorService.swift

File: example_projects/.../CalculatorService.swift
Coverage: 83.1% (157/189 lines)

🔴 Not Covered (7 functions, 22 lines)
  L159  CalculatorService.deleteLastDigit() — 0/16 lines
  L58  implicit closure #2 in inputNumber(_:) — 0/1 lines

🟡 Partial Coverage (4 functions)
  L184  updateExpressionDisplay() — 80.0% (8/10 lines)
  L195  formatNumber(_:) — 85.7% (18/21 lines)

🟢 Full Coverage (28 functions) — all at 100%

Next steps:
1. View overall coverage: xcodebuildmcp coverage get-coverage-report --xcresult-path "/tmp/TestResults.xcresult"
```

#### List Simulators (generic pipeline — new)

```text
📱 List Simulators

iOS 18.5:
  iPhone 16 Pro    A1B2C3D4-...  Booted
  iPhone 16        E5F6G7H8-...  Shutdown
  iPad Pro 13"     I9J0K1L2-...  Shutdown

iOS 17.5:
  iPhone 15        M3N4O5P6-...  Shutdown

Next steps:
1. Boot simulator: xcodebuildmcp simulator-management boot --simulator-id "UUID"
```

#### Set Appearance (generic pipeline — new)

```text
🎨 Set Appearance

  Simulator: A1B2C3D4-E5F6-...

✅ Appearance set to dark mode
```

#### Discover Projects (generic pipeline — new)

```text
🔍 Discover Projects

  Search Path: .

Workspaces:
  example_projects/iOS_Calculator/CalculatorApp.xcworkspace

Projects:
  example_projects/iOS_Calculator/CalculatorApp.xcodeproj

Next steps:
1. List schemes: xcodebuildmcp project-discovery list-schemes --workspace-path "example_projects/iOS_Calculator/CalculatorApp.xcworkspace"
```

## Xcodebuild pipeline specifics

The existing xcodebuild pipeline architecture is preserved. This section documents it for reference.

### Execution flow

1. Tool calls `startBuildPipeline(...)` from `src/utils/xcodebuild-pipeline.ts`
2. Pipeline creates parser and run-state, emits initial `start` event
3. Raw stdout/stderr chunks feed into `createXcodebuildEventParser(...)`
4. Parser emits structured events into `createXcodebuildRunState(...)`
5. Tool-emitted events (post-build notices, errors) enter run-state through `pipeline.emitEvent(...)`
6. Run-state dedupes, orders, aggregates, forwards to the unified renderer
7. On finalize: summary + tail events + next-steps emitted in order

### Canonical pattern

```ts
const started = startBuildPipeline({
  operation: 'BUILD',
  toolName: 'build_run_<platform>',
  params: { scheme, configuration, platform, preflight: preflightText },
  message: preflightText,
});

const buildResult = await executeXcodeBuildCommand(..., started.pipeline);
if (buildResult.isError) {
  return createPendingXcodebuildResponse(started, buildResult, {
    errorFallbackPolicy: 'if-no-structured-diagnostics',
  });
}

// Post-build steps: emit notices for progress, errors for failures
emitPipelineNotice(started, 'BUILD', 'Resolving app path', 'info', {
  code: 'build-run-step',
  data: { step: 'resolve-app-path', status: 'started' },
});

// ... resolve, boot, install, launch ...

return createPendingXcodebuildResponse(
  started,
  { content: [], isError: false, nextStepParams: { ... } },
  {
    tailEvents: [{
      type: 'notice',
      timestamp: new Date().toISOString(),
      operation: 'BUILD',
      level: 'success',
      message: 'Build & Run complete',
      code: 'build-run-result',
      data: { scheme, platform, target, appPath, bundleId, launchState: 'requested' },
    }],
  },
);
```

### Pending response lifecycle

1. Tool returns `createPendingXcodebuildResponse(started, response, options)`
2. `postProcessToolResponse` in `src/runtime/tool-invoker.ts` detects the pending state
3. Resolves manifest-driven next-step templates against `nextStepParams`
4. Calls `finalizePendingXcodebuildResponse` which finalizes the pipeline
5. Finalized content becomes `ToolResponse.content`

### Post-build step notices

Post-build steps use `notice` events with `code: 'build-run-step'`:

Available step names (defined in `BuildRunStepName` in `src/types/xcodebuild-events.ts`):

- `resolve-app-path`
- `resolve-simulator`
- `boot-simulator`
- `install-app`
- `extract-bundle-id`
- `launch-app`

To add new steps: extend `BuildRunStepName` and add the label in `formatBuildRunStepLabel` in `src/utils/renderers/event-formatting.ts`.

### Error message convention

All post-build errors via `emitPipelineError` use: `Failed to <action>: <detail>`

### All errors get grouped rendering

All error events are batched and rendered as a single grouped section before the summary:

- If any error has a file location: `Compiler Errors (N):`
- Otherwise: `Errors (N):`

Each error: `  ✗ <message>` with optional `    <location>` and continuation lines.

### Error event message field

The `message` field must not include severity prefix. Correct: `"unterminated string literal"`. Wrong: `"error: unterminated string literal"`. The `rawLine` field preserves the original verbatim.

## Implementation steps

One canonical list. Checked items are done. Remaining items are work-in-progress.

### Infrastructure (done)

- [x] Define `PipelineEvent` union type in `src/types/pipeline-events.ts` (named `PipelineEvent`, not `ToolEvent`)
- [x] Define `toolResponse()` builder + helper functions: `header()`, `section()`, `statusLine()`, `fileRef()`, `table()`, `detailTree()`, `nextSteps()` in `src/utils/tool-event-builders.ts`
- [x] Build shared formatting layer in `src/utils/renderers/event-formatting.ts`
- [x] Build MCP renderer (`src/utils/renderers/mcp-renderer.ts`) — buffers formatted text for `ToolResponse.content`
- [x] Build CLI text renderer (`src/utils/renderers/cli-text-renderer.ts`) — streaming text to stdout with interactive spinner support
- [x] Preserve CLI JSONL renderer (`src/utils/renderers/cli-jsonl-renderer.ts`) for machine-readable output
- [x] Build `resolveRenderers()` orchestration in `src/utils/renderers/index.ts`
- [x] Build `toolResponse()` entry point in `src/utils/tool-response.ts` that feeds events through renderers
- [x] Migrate xcodebuild pipeline run-state to emit `PipelineEvent` types through renderers (preserve parser, run-state, streaming, Clack)
- [x] Write designed fixtures for all tools (`__fixtures_designed__/`)

### Tool migration (mostly done)

- [x] Migrate xcodebuild tools: `build_sim`, `build_device`, `build_macos`, `build_run_sim`, `build_run_device`, `build_run_macos`
- [x] Migrate simple action tools: `set_sim_appearance`, `set_sim_location`, `reset_sim_location`, `sim_statusbar`, `boot_sim`, `open_sim`, `stop_app_sim`, `stop_app_device`, `stop_mac_app`, `launch_app_sim`, `launch_app_device`, `launch_mac_app`, `install_app_sim`, `install_app_device`
- [x] Migrate most query tools: `list_sims`, `discover_projs`, `list_schemes`, `show_build_settings`, `get_app_bundle_id`, `get_mac_bundle_id`
- [x] Migrate coverage tools: `get_coverage_report`, `get_file_coverage`
- [x] Migrate scaffolding tools: `scaffold_ios_project`, `scaffold_macos_project`
- [x] Migrate session tools: `session_set_defaults`, `session_clear_defaults`, `session_use_defaults_profile`
- [x] Migrate logging tools: `start_sim_log_cap`, `stop_sim_log_cap`, `start_device_log_cap`, `stop_device_log_cap`
- [x] Migrate debugging tools: `debug_attach_sim`, `debug_breakpoint_add`, `debug_breakpoint_remove`, `debug_continue`, `debug_detach`, `debug_lldb_command`, `debug_stack`, `debug_variables`
- [x] Migrate UI automation tools: `snapshot_ui`, `tap`, `type_text`, `button`, `gesture`, `key_press`, `key_sequence`, `long_press`, `swipe`, `touch`
- [x] Migrate swift-package tools: `swift_package_build`, `swift_package_clean`, `swift_package_list`, `swift_package_stop`
- [x] Migrate xcode-ide tools: `xcode_ide_call_tool`, `xcode_ide_list_tools`, `xcode_tools_bridge_disconnect`, `xcode_tools_bridge_status`, `xcode_tools_bridge_sync`, `sync_xcode_defaults`
- [x] Migrate doctor tool

### Remaining: tools that were migrated then reverted to manual text

These tools were migrated to the pipeline in `ac33b97f` but reverted to manual `ToolResponse` construction in `c0693a1d`. The fixtures in `__fixtures__/` define the correct target output. The pipeline (renderers and/or event types) needs to be extended to produce that output — the tools should NOT hand-craft text to match fixtures.

- [x] Re-migrate `get_sim_app_path` — extended `SectionEvent` with `blankLineAfterTitle`, added `extractQueryErrorMessages`, added `suppressCliStream` to `toolResponse()` for late-bound CLI next steps
- [x] Re-migrate `get_device_app_path` — same approach
- [x] Re-migrate `get_mac_app_path` — same approach
- [x] Re-migrate `list_devices` success path — uses `blankLineAfterTitle` sections for grouped-by-platform layout
- [x] Clean up `swift_package_run` error fallback — removed manual content, relies on pipeline-produced structured diagnostics
- [x] Clean up `swift_package_test` error fallback — same
- [ ] Re-migrate `session_show_defaults` — remove inline emoji from section titles, use `detailTree()` instead of manual tree connectors
- [ ] Re-migrate `screenshot` — remove manual content branches for base64 fallback

### Remaining: presentation leakage in migrated tools

These tools use `toolResponse()` but embed presentation details in event payloads that should be owned by the renderer:

- [ ] `list_sims` — remove inline emoji and `✓`/`✗` markers from section content; these should come from the renderer or event type metadata
- [ ] `session_show_defaults` — use `detailTree()` events instead of `formatDetailLines()` manual tree connectors

### Remaining: cleanup

- [ ] Delete `formatToolPreflight` in `src/utils/build-preflight.ts` once all tools use pipeline `HeaderEvent`
- [ ] All snapshot tests pass against `__fixtures__/` (target output)
- [ ] Manual verification of CLI output for representative tools

## Success criteria

This work is successful when:

- every tool emits structured events through the pipeline
- shared formatting functions in `event-formatting.ts` produce all formatted output
- CLI and MCP durable output are identical (CLI interactive mode may show transient spinner updates)
- file paths are always normalised — no tool can produce a raw absolute path
- spacing between sections is always correct — no tool can get it wrong
- the only way to add a new tool's output is to emit events — there is no escape hatch
- adding a new output format (e.g. markdown, HTML) requires only a new renderer, not touching any tool code
- all `__fixtures__/` snapshot tests pass with output produced by the pipeline, not by manual text construction

## Design constraints

- all text formatting lives in `event-formatting.ts` — renderers orchestrate, they do not contain formatting logic
- no formatted text construction inside tool logic
- no emoji characters inside tool logic (formatting layer owns the mapping)
- no `displayPath()` calls inside tool logic (formatting layer owns path normalisation)
- no spacing/indentation decisions inside tool logic (formatting layer owns layout)
- xcodebuild event parser and run-state layer are preserved — they work well and do not need to change
- CLI JSONL mode is preserved for all tools
- no attempt to make non-xcodebuild tools streamable initially — they complete fast enough that buffered rendering is fine
- if the pipeline cannot produce a fixture's target output, extend the pipeline (new event types, new formatting functions) — do not bypass the pipeline to match fixtures manually
