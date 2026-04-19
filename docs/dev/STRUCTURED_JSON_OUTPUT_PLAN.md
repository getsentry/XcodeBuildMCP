# Structured JSON Output Plan

## Goal

Change CLI output modes so that:

- `--output text` stays as the current human-readable output
- `--output jsonl` becomes the current event-stream output (today exposed as `json`)
- `--output json` becomes a new structured JSON document representing the tool's primary result
- `--output raw` stays unchanged

This plan is based on the current implementation, not the stale `docs/dev/RENDERING_PIPELINE_REFACTOR.md` redesign.

## Requirements

1. Rename the current `json` output mode to `jsonl`
2. Add a new structured `json` mode
3. Preserve current text output behavior without regressions
4. Preserve current event-stream behavior without regressions
5. Exclude auxiliary output from structured JSON:
   - no next steps
   - no frontmatter
   - no event stream passthrough
6. Standardize structured JSON around a common envelope
7. Codify per-tool outputs as versioned schemas
8. Add snapshot coverage for structured JSON output
9. Prefer the cleanest, lowest-churn design over a broad pipeline rewrite

## Current architecture

The current flow is already good enough to support this change incrementally:

- tools emit `PipelineEvent`s through `ToolHandlerContext.emit`
- CLI creates a `RenderSession`
- the session accumulates:
  - events
  - attachments
  - error state
- `postProcessSession()` appends `next-steps` as another event
- CLI decides how output is rendered/printed based on `--output`

Today:

- `--output text` uses `cli-text`
- `--output raw` uses `text`
- `--output json` uses `cli-json`, which actually prints one JSON event per line

So current `json` is semantically JSONL already.

## Recommended architecture

### Decision

Implement structured JSON as a CLI-boundary projection over the final `RenderSession`.

That means:

1. run the tool normally
2. let it emit its normal `PipelineEvent`s
3. let daemon-backed tools replay into the same CLI-side session as they do today
4. let `postProcessSession()` run as it does today
5. for `--output json`, build one structured JSON object from the final session state

### Why this is the right design

This avoids the wrong kind of complexity.

We should **not**:

- rewrite tool handlers to return new result types
- refactor MCP output
- change daemon protocol
- add a separate deep rendering pipeline for structured JSON
- parse rendered text back into JSON

We **should**:

- keep text and jsonl on the existing event/session path
- add structured JSON only at the final CLI output boundary

This keeps the design simple:

- one event production path
- one session capture model
- two presentation styles from the same source:
  - streamed event output (`jsonl`)
  - final projected output (`json`)

## Output model

## Structured JSON envelope

All structured JSON responses should use one envelope shape:

```json
{
  "schema": "xcodebuildmcp.output.simulator-list",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {}
}
```

### Fields

- `schema`
  - stable identifier for the payload contract
  - example: `xcodebuildmcp.output.simulator-list`
- `schemaVersion`
  - manual contract version
  - start at `"1"`
  - bump only for breaking changes
- `didError`
  - whether the command failed
- `error`
  - standardized human-readable failure string
  - `null` on success
- `data`
  - the primary structured result
  - `null` when no meaningful primary data exists

## Rules for structured JSON

- emit exactly one JSON document
- pretty-print with 2-space indentation
- include a trailing newline
- never include next steps
- never include `_meta`
- never include raw `PipelineEvent[]`
- never include rendered human text blocks just to mirror the text mode

## Error shape

Structured JSON should always remain parseable.

If the tool fails:

```json
{
  "schema": "xcodebuildmcp.output.app-path",
  "schemaVersion": "1",
  "didError": true,
  "error": "App path lookup failed",
  "data": null
}
```

If structured-output generation itself fails internally, still emit a valid envelope with:

- `didError: true`
- `error: "Structured output generation failed: ..."`
- `data: null`

## Schema design

## Per-tool schema definitions

Define structured output schemas in code, not in manifest YAML.

Recommended module layout:

- `src/structured-output/types.ts`
- `src/structured-output/helpers.ts`
- `src/structured-output/registry.ts`
- `src/structured-output/index.ts`
- `src/structured-output/definitions/common.ts`
- workflow-specific definition files:
  - `coverage.ts`
  - `debugging.ts`
  - `device.ts`
  - `doctor.ts`
  - `macos.ts`
  - `project-discovery.ts`
  - `project-scaffolding.ts`
  - `session-management.ts`
  - `simulator.ts`
  - `simulator-management.ts`
  - `swift-package.ts`
  - `ui-automation.ts`
  - `utilities.ts`
  - `workflow-discovery.ts`
  - `xcode-ide.ts`

## Definition shape

Each schema definition should include:

- schema id
- schema version
- associated tool ids
- a Zod schema for the `data` payload
- a builder that projects data from the final event session

Conceptually:

```ts
interface StructuredOutputDefinition<TData> {
  schema: string;
  schemaVersion: string;
  toolKeys: readonly string[];
  dataSchema: z.ZodType<TData>;
  build(input: StructuredOutputBuildInput, view: StructuredEventView): TData | null;
}
```

## Event view

Create one indexed event view from the final session events, excluding `next-steps`.

That view should expose grouped access to:

- header
- status lines
- summaries
- detail trees
- tables
- sections
- file refs
- compiler errors
- compiler warnings
- test discovery
- test failures

This avoids scattered ad hoc event scanning in every tool definition.

## Shared schema families

Not every tool should get its own bespoke `data` shape.

A core goal of this design is that consumers should be able to write a small number of parsers for shared output families, not hundreds of parsers for equivalent data exposed by different tools.

That means:

- prefer shared schema families over per-tool schemas
- prefer shared field names across related tool results
- use tool-specific schemas only when the primary data is genuinely different
- compose from common sub-schemas rather than inventing new top-level structures casually

Examples:

- `xcodebuildmcp.output.app-path`
  - `get_sim_app_path`
  - `get_device_app_path`
  - `get_mac_app_path`
- `xcodebuildmcp.output.bundle-id`
  - `get_app_bundle_id`
  - `get_mac_bundle_id`
- `xcodebuildmcp.output.simulator-list`
  - simulator list commands with the same payload shape
- `xcodebuildmcp.output.launch-result`
  - `launch_app_sim`
  - `launch_app_device`
  - `launch_mac_app`
- `xcodebuildmcp.output.build-result`
  - `build_sim`
  - `build_device`
  - `build_macos`
  - `swift_package_build`

Use shared contracts where it reduces duplication cleanly.

## Common base shapes

The doc should explicitly bias toward reusable base shapes.

Recommended common sub-schemas:

- `summary`
  - status
  - duration
  - optional test counts
- `diagnostics`
  - warnings
  - errors
  - testFailures when relevant
- `artifacts`
  - appPath
  - bundleId
  - processId
  - simulatorId
  - deviceId
  - buildLogPath
  - runtimeLogPath
  - osLogPath
- `entries`
  - ordered key/value outputs
- `items`
  - normalized list outputs

The important rule is consistency:

- if `appPath` is part of a result, it should live in the same place for every schema family that uses it
- if `processId` is part of a result, it should live in the same place for every schema family that uses it
- if `buildLogPath` is emitted, it should not move around between sibling schemas

### Normalization rule for durable outputs

For durable outputs that are artifacts of the command result, prefer nesting them under `artifacts` rather than placing them at the top level opportunistically.

That means the plan should normalize toward shapes like:

```json
{
  "data": {
    "summary": {
      "status": "SUCCEEDED",
      "durationMs": 5234
    },
    "artifacts": {
      "appPath": "...",
      "bundleId": "com.example.CalculatorApp",
      "processId": 12345,
      "simulatorId": "...",
      "buildLogPath": "..."
    },
    "diagnostics": {
      "warnings": [],
      "errors": []
    }
  }
}
```

For simple lookup-only results, a reduced version of the same idea still applies:

```json
{
  "data": {
    "artifacts": {
      "appPath": "..."
    }
  }
}
```

This is preferable to having one tool emit `data.appPath` and another emit `data.artifacts.appPath` unless there is a very strong reason.

## Schema-family matrix

The implementation should begin with an audit that groups tools into shared result families before any code is written.

A recommended initial family matrix is:

| Schema family | Shared `data` shape intent | Example tools |
|---|---|---|
| `app-path` | `artifacts.appPath` | `get_sim_app_path`, `get_device_app_path`, `get_mac_app_path` |
| `bundle-id` | `artifacts.bundleId` | `get_app_bundle_id`, `get_mac_bundle_id` |
| `launch-result` | `artifacts.bundleId`, `artifacts.processId`, target id | `launch_app_sim`, `launch_app_device`, `launch_mac_app` |
| `install-result` | target id + installed artifact identity where available | `install_app_sim`, `install_app_device` |
| `stop-result` | target id + stopped process/app identity where available | `stop_app_sim`, `stop_app_device`, `stop_mac_app`, `swift_package_stop` |
| `build-result` | `summary`, `artifacts`, `diagnostics` | `build_sim`, `build_device`, `build_macos`, `swift_package_build`, `clean` |
| `test-result` | `summary`, `diagnostics`, optional discoveries/artifacts | `test_sim`, `test_device`, `test_macos`, `swift_package_test` |
| `build-run-result` | `summary`, `artifacts`, `diagnostics` | `build_run_sim`, `build_run_device`, `build_run_macos`, possibly `swift_package_run` if it fits cleanly |
| `simulator-list` | `simulators[]` normalized records | `list_sims` |
| `device-list` | `devices[]` normalized records | `list_devices` |
| `scheme-list` | `schemes[]` | `list_schemes` |
| `project-list` | `projects[]` | `discover_projects` |
| `settings-entries` | ordered `entries[]` | `show_build_settings`, session/defaults-style key-value outputs where appropriate |
| `coverage-result` | summary + coverage entries | `get_coverage_report`, `get_file_coverage` |
| `ui-action-result` | action target + artifact refs if produced | `tap`, `swipe`, `touch`, `long_press`, `button`, `gesture`, `type_text`, `key_press`, `key_sequence` |
| `capture-result` | artifact paths and capture metadata | `screenshot`, `snapshot_ui`, `record_sim_video` |
| `normalized-content` | generic fallback for proxy/dynamic tools | dynamic xcode-ide style tools |

This matrix should be refined from a real tool audit, but the principle should not change: group by result semantics, not by command name.

## Versioning policy

### Start point

Every new schema starts at version `"1"`.

### Bump `schemaVersion` for breaking changes

Examples:

- renaming a field
- removing a field
- changing a field type
- changing the structure of arrays/objects incompatibly
- changing semantic meaning of an existing field

### Do not bump for non-breaking changes

Examples:

- internal extraction refactors
- text formatting changes
- adding truly optional fields

## Zod validation

Each `data` payload should be validated against a strict Zod schema before emission.

That gives us:

- fail-fast schema drift detection
- a clear version boundary
- confidence that fixtures match actual contracts

## How structured JSON is derived

## Derivation point

Derive structured JSON in the CLI command handler after tool invocation completes.

Practically, this means wiring it in `src/cli/register-tool-commands.ts` after `await invoker.invokeDirect(...)` returns.

At that point the CLI already has:

- `session.getEvents()`
- `session.getAttachments()`
- `session.isError()`

That is the cleanest seam because it works equally for:

- direct CLI tools
- daemon-backed CLI tools

without changing daemon or MCP contracts.

## Filtering

Structured JSON builders must ignore:

- `next-steps`
- any future auxiliary presentation-only event types

The structured payload should represent only the tool's primary result.

## Extraction strategy

Prefer data extraction in this order:

1. typed event fields directly
   - detail tree items
   - table rows
   - file refs
   - summaries
   - test/diagnostic events
2. command args where the result is basically the performed action
3. tool-specific parsing of `SectionEvent.title` and `SectionEvent.lines` only when needed
4. never parse rendered text output

This is an important constraint: structured JSON should be projected from the event model, not reverse-engineered from final text.

## CLI changes

## Output option changes

Change CLI output choices from:

- `text`
- `json`
- `raw`

to:

- `text`
- `json`
- `jsonl`
- `raw`

### Semantics

- `text`: current human-readable CLI output
- `jsonl`: current event stream output, one JSON event per line
- `json`: new structured result envelope
- `raw`: unchanged

## Internal render strategy rename

Rename internal render strategy naming to match the new CLI terminology:

- `cli-json` -> `cli-jsonl`

Behavior remains the same.

## `--output json` behavior

For `json` mode:

- use a silent capture session rather than the streaming JSONL session
- do not print streamed output
- after execution, build the structured JSON envelope from the final session
- print the envelope once
- set exit code from the structured result/session error state

## Early CLI validation failures

Current CLI validation has early `console.error(...)` branches for things like:

- invalid `--json`
- unknown defaults profile
- missing required arguments
- unexpected args

These must be updated so that when `--output json` is selected they emit a structured error envelope instead of plain text.

This is required to keep machine output clean and parseable.

For other output modes, existing behavior should remain unchanged.

## Tool schema guidance

Use consistent field naming across tools.

Preferred common field names:

- `appPath`
- `bundleId`
- `processId`
- `simulatorId`
- `deviceId`
- `buildLogPath`
- `runtimeLogPath`
- `osLogPath`

Collections should use plural nouns:

- `simulators`
- `devices`
- `schemes`
- `projects`
- `tests`
- `entries`

For open-ended map-like outputs, prefer deterministic entry arrays over unordered freeform objects where snapshot stability matters.

Example:

```json
{
  "entries": [
    { "key": "PRODUCT_NAME", "value": "CalculatorApp" }
  ]
}
```

## Dynamic and proxy tools

For dynamic xcode-ide style tools, do not block this work on designing perfect bespoke schemas for every dynamic result.

Use a generic normalized-content schema as a fallback for proxy-style tools, based on normalized event content such as:

- header
- detail trees
- tables
- sections
- file refs
- summary

This should still exclude next steps and raw event passthrough.

## Example tool responses

The doc needs concrete examples because the envelope by itself is not the hard part. The important part is what goes in `data`.

These are representative target shapes, not final frozen contracts.

### Example: `get_sim_app_path`

Schema:

- `schema: "xcodebuildmcp.output.app-path"`
- `schemaVersion: "1"`

```json
{
  "schema": "xcodebuildmcp.output.app-path",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {
    "artifacts": {
      "appPath": "~/Library/Developer/Xcode/DerivedData/.../Build/Products/Debug-iphonesimulator/CalculatorApp.app",
      "simulatorId": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
    }
  }
}
```

Notes:

- shared schema family with device/macOS app-path tools is fine
- this now follows the same `artifacts` convention as other durable outputs
- if target identity is known and useful, keep it in `artifacts`; otherwise omit it rather than inventing a new layout
### Example: `list_sims`

Schema:

- `schema: "xcodebuildmcp.output.simulator-list"`
- `schemaVersion: "1"`

```json
{
  "schema": "xcodebuildmcp.output.simulator-list",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {
    "simulators": [
      {
        "name": "iPhone 16",
        "simulatorId": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        "state": "Shutdown",
        "isAvailable": true,
        "runtime": "iOS 18.0"
      },
      {
        "name": "iPhone 16 Pro",
        "simulatorId": "FFFFFFFF-1111-2222-3333-444444444444",
        "state": "Booted",
        "isAvailable": true,
        "runtime": "iOS 18.0"
      }
    ]
  }
}
```

Notes:

- this is a good example of primary data replacing presentation-only text/grouping
- text mode can keep emojis and grouped display; structured JSON should just expose normalized data
- if the current event stream does not expose enough data directly, this is the kind of case where we may need a small tool-specific extractor against event payloads

### Example: `launch_app_sim`

Schema:

- `schema: "xcodebuildmcp.output.launch-result"`
- `schemaVersion: "1"`

```json
{
  "schema": "xcodebuildmcp.output.launch-result",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {
    "artifacts": {
      "bundleId": "com.example.CalculatorApp",
      "simulatorId": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      "processId": 12345
    }
  }
}
```

Notes:

- this is a simple action-result shape
- it now uses the same `artifacts` nesting as build-style results
- snapshot helpers can still reuse these fields; they just read them from a consistent location
### Example: `show_build_settings`

Schema:

- `schema: "xcodebuildmcp.output.build-settings"`
- `schemaVersion: "1"`

```json
{
  "schema": "xcodebuildmcp.output.build-settings",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {
    "entries": [
      { "key": "PRODUCT_NAME", "value": "CalculatorApp" },
      { "key": "PRODUCT_BUNDLE_IDENTIFIER", "value": "com.example.CalculatorApp" },
      { "key": "SDKROOT", "value": "iphonesimulator" }
    ]
  }
}
```

Notes:

- use ordered `entries` rather than a large freeform object for better snapshot stability
- if we later decide consumers strongly prefer an object map, that would be a schema decision and versioning question, not something to drift into accidentally

### Example: `build_sim` or `build_macos`

Schema:

- `schema: "xcodebuildmcp.output.build-result"`
- `schemaVersion: "1"`

```json
{
  "schema": "xcodebuildmcp.output.build-result",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {
    "summary": {
      "status": "SUCCEEDED",
      "durationMs": 5234
    },
    "artifacts": {
      "appPath": "~/Library/Developer/Xcode/DerivedData/.../Build/Products/Debug-iphonesimulator/CalculatorApp.app",
      "buildLogPath": "~/Library/Logs/XcodeBuildMCP/build.log"
    },
    "diagnostics": {
      "warnings": [],
      "errors": []
    }
  }
}
```

Notes:

- for build/test-style tools, `data` should focus on durable result data, not transient stage events
- build stages belong in `jsonl`, not structured `json`
- this keeps the split between event stream and result document clear

### Example: failed build

```json
{
  "schema": "xcodebuildmcp.output.build-result",
  "schemaVersion": "1",
  "didError": true,
  "error": "Build failed",
  "data": {
    "summary": {
      "status": "FAILED",
      "durationMs": 8123
    },
    "diagnostics": {
      "warnings": [],
      "errors": [
        {
          "message": "Cannot find 'FooBar' in scope",
          "location": "Sources/App/ContentView.swift:42:13"
        }
      ]
    },
    "artifacts": {
      "buildLogPath": "~/Library/Logs/XcodeBuildMCP/build.log"
    }
  }
}
```

Notes:

- failure does not have to force `data` to `null`
- if we have durable structured failure data, we should keep it
- `error` stays the standardized top-level quick summary; `data.diagnostics` carries the details

### Example: CLI validation failure before tool execution

This is the case that currently goes through `console.error(...)` and needs special handling in structured mode.

```json
{
  "schema": "xcodebuildmcp.output.launch-result",
  "schemaVersion": "1",
  "didError": true,
  "error": "Missing required argument: simulator-id",
  "data": null
}
```

Notes:

- this is why `--output json` needs custom early-error handling
- machine consumers should still get one valid envelope even when the tool never started

## Testing plan

## Unit tests

Add unit coverage for:

- output mode wiring
- `json` vs `jsonl` dispatch
- structured error envelope generation
- schema registry uniqueness
- envelope building behavior
- event filtering that excludes `next-steps`
- manifest coverage so every CLI-exposed tool has a structured-output definition

That manifest coverage test is important. It prevents future drift when new tools are added.

## Snapshot tests

### Principle

Keep the existing text snapshots intact.

Add a parallel fixture set for CLI structured JSON rather than replacing current fixtures.

### Fixture layout

Keep current fixtures:

- `src/snapshot-tests/__fixtures__/cli/.../*.txt`
- `src/snapshot-tests/__fixtures__/mcp/.../*.txt`

Add new structured fixtures:

- `src/snapshot-tests/__fixtures__/cli-json/.../*.json`

### Harness changes

Extend the snapshot harness to accept an output mode:

- default remains `text`
- add `json`
- add `jsonl` if we want explicit event-stream snapshot coverage later

### Normalization

Add JSON-aware normalization that:

- parses the envelope
- recursively normalizes paths, UUID-like values, and other unstable values
- re-serializes deterministically with 2-space indentation

Do not normalize structured JSON with regex over raw text.

### Parser helpers

Update snapshot parser helpers so they first check structured JSON fields, then fall back to existing text parsing.

For example:

- `extractAppPathFromSnapshotOutput()` should first look at `data.appPath`
- `extractProcessIdFromSnapshotOutput()` should first look at `data.processId`

This is another reason to keep field naming consistent.

## Docs and migration

## Documentation updates

Update:

- `docs/CLI.md`
- `docs/dev/RENDERING_PIPELINE.md`
- `README.md`
- any examples or tests that currently describe `--output json` as the event stream mode

## Changelog

Record this as a breaking CLI contract change:

- `--output json` now means structured JSON
- previous event-stream behavior moves to `--output jsonl`

## Stale doc cleanup

`docs/dev/RENDERING_PIPELINE_REFACTOR.md` is stale and should be removed or replaced after this plan is implemented, so it does not keep misleading future work.

## Risks and tradeoffs

## Main risk

The main risk is not the CLI wiring. The main risk is extracting clean structured payloads for every tool from the current event model without introducing brittle special cases.

Mitigation:

- build the schema registry first
- add coverage tests so every tool must be mapped
- prefer shared schema families
- only add tool-specific extraction when needed
- avoid changing text output unless absolutely necessary

## What not to do

- do not do a broad renderer refactor
- do not change daemon protocol unless a real blocker appears
- do not change MCP response contracts for this work
- do not parse rendered text into JSON
- do not include next steps in structured JSON
- do not scatter schema logic across manifests and runtime code

## Implementation plan

### Phase 1: rename and wiring groundwork

1. Rename internal render strategy `cli-json` -> `cli-jsonl`
2. Extend CLI output enum to include `jsonl`
3. Update CLI help text and output selection wiring
4. Preserve existing event-stream behavior under `jsonl`

### Phase 2: structured-output core

1. Add `src/structured-output/` module
2. Define envelope type and schema definition contract
3. Add event indexing helpers
4. Add registry lookup by tool id
5. Add envelope/error-building helpers

### Phase 3: per-tool schema definitions

1. Implement workflow/family schema definitions
2. Prefer shared contracts where sensible
3. Add fallback normalized-content schema for proxy/dynamic tools
4. Add a manifest coverage test to require complete tool coverage

### Phase 4: CLI structured JSON integration

1. Wire `--output json` to build a single envelope from the final session
2. Update early validation failures to emit structured error envelopes in `json` mode
3. Ensure stdout remains clean machine output in structured mode
4. Preserve exit code behavior

### Phase 5: snapshot coverage

1. Extend snapshot harness/contracts for output mode selection
2. Add JSON normalization support
3. Add `cli-json` fixture tree
4. Add structured JSON snapshot coverage across CLI-capable suites
5. Keep existing text fixtures unchanged

### Phase 6: docs and migration

1. Update CLI docs and README examples
2. Update rendering pipeline documentation
3. Add changelog entry
4. Remove or replace stale output/refactor docs

## Suggested quality gates

Before handoff, run the relevant non-doc checks for the implementation work:

- `npm run typecheck`
- `npm run test`
- `npm run test:snapshot`
- any targeted smoke coverage if output-mode CLI tests exist

For this planning-only change, no checks are required.

## Final recommendation

Treat structured JSON as a projection layer over the finished CLI session, not as a new renderer or a pipeline redesign.

That gives the cleanest maintainable system:

- one event production model
- one shared session capture model
- text output preserved
- jsonl output preserved
- structured json added with low regression risk
- versioned per-tool contracts that can evolve intentionally over time
