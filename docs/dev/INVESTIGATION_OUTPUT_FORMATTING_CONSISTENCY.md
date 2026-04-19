# Investigation: Output Formatting Consistency

## Summary

Two follow-up questions answered: (1) The three-renderer architecture was the **original implementation choice from day one** — the plan's "one renderer, two sinks" vision was never attempted because interactive CLI behavior requires state-machine logic incompatible with "dumb pipe" sinks. (2) The 6 holdout tools match their fixtures because they were **actually migrated to the pipeline** in commit `ac33b97f`, then **deliberately reverted** in commit `c0693a1d` (WIP). Fixtures were updated to match the reverted format. The snapshot harness validates final text only, not pipeline provenance.

## Symptoms

- Three separate renderers exist instead of the plan's "one renderer, two sinks"
- 6 tool files still manually construct ToolResponse objects
- These holdout tools have passing snapshot fixtures despite bypassing the pipeline

## Investigation Log

### Phase 1 — Why Three Renderers Instead of One?

**Hypothesis:** The implementation started with one renderer and was later split into three.

**Findings:** **Eliminated.** Git archaeology shows the three-renderer pattern was the original design from the first commit:

**Commit `1374d3c2` (March 21)** — "Unify pipeline architecture, rendering, and output formatting"
- This is when `mcp-renderer.ts`, `cli-text-renderer.ts`, and `cli-jsonl-renderer.ts` were **first created** (confirmed via `git log --diff-filter=A`)
- The initial `index.ts` already had `resolveRenderers()` returning multiple renderer instances
- At this point, renderers only handled `XcodebuildEvent` types

**Commit `ac33b97f` (March 25)** — "Migrate all tool output to unified PipelineEvent system"
- Upgraded all three renderers from `XcodebuildEvent` to generic `PipelineEvent`
- Added generic event type handlers (`header`, `status-line`, `section`, `detail-tree`, `table`, `file-ref`)
- The three-renderer architecture was preserved and extended, not questioned

**Evidence:** The plan document's "one renderer, two sinks" was written as a forward-looking vision. The implementer chose separate renderers from the start because:

1. **CLI text renderer requires state-machine logic** that can't be a "dumb pipe":
   - Tracks `pendingTransientRuntimeLine` for spinner management (`cli-text-renderer.ts:46`)
   - Tracks `hasDurableRuntimeContent` for flush decisions (`cli-text-renderer.ts:47`)
   - Tracks `lastVisibleEventType` and `lastStatusLineLevel` for compact spacing (`cli-text-renderer.ts:48-49`)
   - Uses `createCliProgressReporter()` for Clack spinner integration (`cli-text-renderer.ts:45`)
   - Has conditional logic for `interactive` mode (`cli-text-renderer.ts:84-88` for `build-stage`, `cli-text-renderer.ts:93-105` for `status-line`)

2. **MCP renderer has different semantics**:
   - Buffers text parts as strings, returns `ToolResponseContent[]` (`mcp-renderer.ts:36-37, 147-152`)
   - Applies session-level `suppressWarnings` (`mcp-renderer.ts:34`)
   - Different spacing rules (e.g., `section` uses `\n\n` prefix at `mcp-renderer.ts:68`, CLI uses `writeSection()` which adds `\n`)

3. **JSONL renderer bypasses text rendering entirely**:
   - Serializes raw events as JSON: `process.stdout.write(JSON.stringify(event) + '\n')` (`cli-jsonl-renderer.ts`)
   - Making this a "sink" of a text renderer doesn't make architectural sense

4. **Shared formatting layer already exists**:
   - `event-formatting.ts` contains all shared format functions (`formatHeaderEvent`, `formatStatusLineEvent`, `formatSectionEvent`, etc.)
   - Both text renderers call the same format functions
   - The difference is in orchestration (buffering vs streaming, transient handling, spacing), not in formatting

**Conclusion:** The three-renderer architecture is a **deliberate pragmatic choice**. The "one renderer, two sinks" model from the plan was aspirational but not viable because CLI interactive behavior (spinners, transient lines, flush timing) requires active event-processing logic. The current design (shared formatters + separate renderers) is functionally equivalent to "shared formatting, runtime-specific orchestration."

---

### Phase 2 — How Do Holdout Tools Match Fixtures?

**Hypothesis:** The holdout tools were never migrated and their fixtures encode their original manual format.

**Findings:** **Eliminated.** The holdout tools were actually migrated and then **reverted**. The git history tells the story clearly:

#### Timeline

1. **Commit `ac33b97f` (March 25)** — All tools migrated to pipeline:
   - `get_sim_app_path.ts` used `toolResponse()`, `header()`, `statusLine()`, `detailTree()`
   - `list_devices.ts` used pipeline events for all paths
   - All 74 fixtures regenerated with pipeline-formatted output
   - Fixture for `get-app-path--success.txt` had 2-space indented params, `detailTree` output, simple "App path resolved" message

2. **Commit `c0693a1d` (March 28, WIP)** — Selective reversion:
   - `get_sim_app_path.ts`: Replaced `toolResponse`/`header`/`statusLine`/`detailTree` with `formatToolPreflight` + manual `content: [{type: 'text'}]`
   - `get_device_app_path.ts`: Same reversion pattern
   - `get_mac_app_path.ts`: Same reversion pattern
   - `list_devices.ts`: Added `renderGroupedDevices()` manual string builder
   - `session_show_defaults.ts`: Added emoji to section titles, manual tree connectors
   - `screenshot.ts`: Added manual content branches
   - **Fixtures simultaneously updated** to match new manual output

**Evidence from fixture diffs:**

`simulator/get-app-path--success.txt` changed FROM (pipeline):
```
  Scheme: CalculatorApp        (2-space indent, pipeline HeaderEvent)
  └ App Path: ...               (detailTree event)
✅ App path resolved            (statusLine event)
```

TO (manual):
```
   Scheme: CalculatorApp       (3-space indent, formatToolPreflight)
✅ Get app path successful (⏱️ <DURATION>)  (inline text with emoji)
  └ App Path: ...              (manual tree connector)
```

`device/list--success.txt` changed FROM (pipeline):
```
🟢 Cameron's Apple Watch       (per-device with detailTree)
  ├ UDID: ...
  ├ Model: Watch4,2
  ├ CPU Architecture: arm64_32
  └ Developer Mode: disabled
```

TO (manual):
```
watchOS Devices:               (grouped by platform)
  ⌚️ [✓] Cameron's Apple Watch  (emoji + availability marker)
    OS: 26.3
    UDID: <UUID>
```

#### Why do fixtures still pass?

The snapshot test harness at `src/snapshot-tests/harness.ts` validates **final text output, not pipeline provenance**:

1. **CLI path** (`invokeCli`, line 124): Spawns `node CLI_PATH workflow tool --json args`, captures stdout
2. **Direct path** (`invokeDirect`, line 141): Calls handler, extracts `ToolResponse.content` text

For manual-text tools (not MCP-only, not stateful), the harness uses CLI invocation:
- Tool returns `ToolResponse` with manual `content[].text`
- `printToolResponse()` in `cli/output.ts` checks `isCompletePipelineStream(response)` — **false** for manual tools (no `_meta.pipelineStreamMode`)
- Falls through to `printToolResponseText()` which writes `content[].text` to stdout
- Harness captures stdout, normalizes via `normalize.ts`, compares to fixture via `expect(actual).toBe(expected)` in `fixture-io.ts`

For pipeline tools:
- CLI text renderer streams formatted output to stdout during execution
- `printToolResponse()` sees `pipelineStreamMode: 'complete'` and **skips printing** (avoids double output)
- Harness captures the already-streamed stdout

Both paths produce stdout text that gets compared to the fixture. The fixture encodes whatever text was actually produced, regardless of whether it came from the pipeline.

**Conclusion:** The holdout tools pass their fixtures because the fixtures were updated to match the reverted manual format. The snapshot suite is a **final output contract test**, not a pipeline provenance test.

---

### Phase 3 — Why Were Tools Reverted?

**Assessment by category:**

#### `get_sim_app_path`, `get_device_app_path`, `get_mac_app_path` — Expedient compromise

The pipeline has all the primitives needed for these tools (`HeaderEvent`, `StatusLineEvent`, `DetailTreeEvent`, `NextStepsEvent`). The reverted format is not something the pipeline can't express — it just uses `formatToolPreflight` (3-space indent) instead of pipeline `HeaderEvent` (2-space indent), and inline emoji instead of renderer-owned formatting.

This reads as a "preserve exact legacy wording/spacing quickly" decision, not a fundamental pipeline limitation.

#### `list_devices` — Deliberate UX preference

This tool has a purpose-built `renderGroupedDevices()` function that produces a grouped-by-platform layout with platform-specific emojis (`📱`, `⌚️`, `📺`, `🥽`) and availability markers (`[✓]`/`[✗]`). The pipeline version showed flat per-device `detailTree` output with hardware details (Model, Product Type, CPU Architecture). The grouped format is arguably better UX for scanning.

That said, the pipeline's `section()` + structured lines could still express this layout.

#### `swift_package_run`, `swift_package_test` — Defensive escape hatch, not reverted UX

These are pipeline-first tools. The manual `content` branch is only hit on command failure:
```typescript
const response: ToolResponse = result.success
  ? { content: [], isError: false }
  : { content: [{ type: 'text', text: result.error || ... }], isError: true };
```

And `errorFallbackPolicy: 'if-no-structured-diagnostics'` in `xcodebuild-output.ts` explicitly suppresses the raw fallback when structured diagnostics exist. The fixtures show pipeline-formatted output. These aren't really "holdouts" — they're pipeline tools with a safety net.

---

## Root Cause

### Q1: Three renderers
The three-renderer architecture was the **pragmatic original design**, not a deviation from the plan. The plan's "one renderer, two sinks" model doesn't account for the interactive state-machine behavior required by the CLI text renderer (spinners, transient/durable line management, test progress updates). The actual architecture — shared formatting helpers + runtime-specific renderers — achieves the plan's goal of consistent formatting while accommodating runtime differences.

### Q2: Fixture matching
The holdout tools pass fixtures through a two-step mechanism:
1. Tools were migrated to the pipeline, then reverted to manual text
2. Fixtures were simultaneously updated to encode the manual output format
3. The snapshot harness compares final stdout text, not pipeline provenance

The reversion was the wrong approach. The fixtures define the target output contract — if the pipeline at migration time couldn't produce the desired format, the pipeline should have been extended (new event types, new formatting functions), not bypassed. The tools were hand-crafted to match the fixtures instead of the pipeline being updated to produce them.

Designed fixtures exist in `__fixtures_designed__/` that show an earlier target format. The actual `__fixtures__/` files represent the current target. Both should be producible by the pipeline.

## Recommendations

### Principle: fixtures define the contract, the pipeline must produce it

The fixtures in `__fixtures__/` define the correct target output. When the pipeline can't produce a fixture's format, **extend the pipeline** (new event types, new formatting functions) — do not bypass the pipeline with manual text construction.

### Re-migrate reverted tools by extending the pipeline

1. **`get_sim_app_path`, `get_device_app_path`, `get_mac_app_path`** — The fixture format (3-space indent header, timing display, success message wording) may require updates to `formatHeaderEvent` or a new formatting variant. Extend the formatting layer to produce the fixture output, then convert tools back to `toolResponse()` with events.

2. **`list_devices` success path** — The fixture defines a grouped-by-platform layout with platform-specific emojis and `[✓]/[✗]` availability markers. This likely requires new event types or formatting capabilities (e.g., a grouped device list event, or enriching `SectionEvent` with platform/availability metadata). Extend the pipeline to support this, then re-migrate the tool.

3. **`swift_package_run/test` error fallback** — Route the error fallback through pipeline events instead of raw `content`. The `errorFallbackPolicy` mechanism should remain, but the fallback itself should be event-shaped.

4. **`session_show_defaults`** — Use `detailTree()` events instead of manual tree connectors. Remove emoji from section titles (renderer should own emoji).

5. **`screenshot`** — Remove manual content branches. For mixed text + image responses, extend the pipeline if needed.

### Fix presentation leakage in migrated tools

6. **`list_sims`** — Remove inline emoji and `✓`/`✗` markers from section content lines. These should come from the formatting layer or event type metadata.

### Documentation (done)

7. **`STRUCTURED_XCODEBUILD_EVENTS_PLAN.md`** — Updated: replaced "one renderer, two sinks" with actual "shared formatters + runtime-specific renderers" architecture. Checked off completed items. Documented remaining work with correct framing.

### Prevent future drift

8. **Consider a lint/test guard** — Add a check that tool files under `src/mcp/tools/` don't directly construct `content: [{ type: 'text' }]` objects. This would catch future regressions where tools bypass the pipeline.
