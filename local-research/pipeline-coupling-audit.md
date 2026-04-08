# Investigation: xcodebuild-pipeline.ts coupling audit

## Summary

The claim that `xcodebuild-pipeline.ts` should be split into a generic `ToolOutputPipeline` and an xcodebuild-specific event parser is **partially valid in diagnosis but wrong in prescription**. The architecture is already split at the correct seam — `toolResponse()` serves as the generic event rendering path (212 call sites), while `xcodebuild-pipeline.ts` is a purpose-built streaming build/test parser (19 call sites). No non-build tool needs a generic streaming pipeline. The real issues are naming and type-boundary clarity, not missing infrastructure.

## Symptoms / Original Claim

> "xcodebuild-pipeline.ts is coupled to xcodebuild - The pipeline should be split into a generic ToolOutputPipeline (events + renderers) and an xcodebuild-specific event parser, so non-build tools can use the same rendering."

## Investigation Log

### Phase 1 — Identifying the coupling

**Hypothesis:** The pipeline is tightly coupled to xcodebuild specifics.

**Findings:** Confirmed. Six concrete coupling points:

1. **API shape** — `createXcodebuildPipeline()` (`xcodebuild-pipeline.ts:168`) takes `operation: XcodebuildOperation` (`'BUILD' | 'TEST'`) and `minimumStage?: XcodebuildStage` as required params.

2. **Hard-wired components** — The factory always creates `createXcodebuildEventParser()` (line 179) and `createXcodebuildRunState()` (line 173). No way to inject alternative parsers or state managers.

3. **Build-specific finalization** — `finalize()` (lines 194–244) flushes the xcodebuild parser, injects build log file refs via `injectBuildLogIntoTailEvents()`, emits parser debug warnings, and exposes `xcresultPath`.

4. **Build-specific header builder** — `startBuildPipeline()` (lines 155–166) and `buildHeaderParams()` (lines 104–139) know about Scheme, Workspace, Project, Simulator, Device, Architecture, xcresult, etc.

5. **Renderer naming** — The renderer interface is `XcodebuildRenderer` (`renderers/index.ts:8`) despite consuming generic `PipelineEvent`s that all tools use.

6. **Mixed event union** — `pipeline-events.ts` defines generic canonical events (lines 27–86: `header`, `status-line`, `summary`, `section`, `detail-tree`, `table`, `file-ref`, `next-steps`) alongside xcodebuild-specific events (lines 88–148: `build-stage`, `compiler-warning`, `compiler-error`, `test-discovery`, `test-progress`, `test-failure`) in a single union with no type-level boundary.

**Evidence:** All line numbers verified by direct file reads.

**Conclusion:** Coupling is real and confirmed.

### Phase 2 — Does a generic layer already exist?

**Hypothesis:** The codebase already has generic rendering infrastructure that non-build tools use.

**Findings:** Confirmed. The generic layer is `toolResponse()` + `tool-event-builders.ts`:

1. **`toolResponse()`** (`tool-response.ts:11–39`) implements the exact pattern a generic pipeline would: resolve renderers → fan out events → finalize → collect MCP content. It handles all event types including xcodebuild-specific ones.

2. **`tool-event-builders.ts`** (88 lines) builds only generic canonical events: `header`, `section`, `statusLine`, `fileRef`, `table`, `detailTree`, `nextSteps`.

3. **Usage ratio** — In `src/mcp/tools/`: **212 calls to `toolResponse()`** vs **19 references to pipeline functions**. The overwhelming majority of tools already use the generic path.

4. **Non-build tool patterns** — Tools like `debug_attach_sim.ts` and `start_device_log_cap.ts` build static event arrays and call `toolResponse()`. Even `start_device_log_cap`, which manages a long-running subprocess, handles its own output buffering without needing streaming pipeline infrastructure.

**Conclusion:** The generic rendering layer exists and is the dominant pattern.

### Phase 3 — Would non-build tools benefit from a generic streaming pipeline?

**Hypothesis:** Non-build tools could benefit from a `ToolOutputPipeline`.

**Findings:** No current evidence of need:

1. **Zero non-build tools** use the streaming pipeline.
2. **No non-build tool** requires parser/state/stage tracking.
3. **`start_device_log_cap.ts`** is the closest candidate (long-running subprocess with stdout/stderr handling), but it manages output via direct stream handlers and log files — it does not need event parsing, stage progression, or summary synthesis.
4. The pipeline is also used by `swift_package_build.ts`, `swift_package_run.ts`, and `swift_package_test.ts` — but these are effectively build/test tools that happen to use `swift` CLI instead of `xcodebuild`. They reuse the xcodebuild parser opportunistically since the output formats overlap (compiler diagnostics, test results, etc.).

**Conclusion:** No current consumer pressure for a generic streaming pipeline. The pipeline's scope is build/test toolchain output, not arbitrary subprocess streaming.

## Root Cause

The claim conflates two separate concerns:

1. **"Non-build tools can't use the same rendering"** — This is false. They already do, via `toolResponse()` which uses the same renderer registry and event formatting as the pipeline.

2. **"The pipeline should be generic"** — This would be premature abstraction. The pipeline's value is specifically in its xcodebuild/swift-toolchain parsing, state tracking, diagnostic dedup, and build log management. Making it generic would strip out its useful specificity without gaining any consumers.

The real issues are cosmetic/type-level:
- `XcodebuildRenderer` is misnamed (it handles all event types)
- `PipelineEvent` mixes generic and domain-specific types without a type boundary
- The pipeline name slightly understates its actual scope (it handles `swift build/test/run` too, not just `xcodebuild`)

## Recommendations

### Do now (low-effort, high-clarity)

1. **Rename `XcodebuildRenderer` → `PipelineRenderer`** in `src/utils/renderers/index.ts:8` and all references. This interface consumes generic `PipelineEvent`s and is used by both the pipeline and `toolResponse()`.

2. **Split event types at the type level** in `src/types/pipeline-events.ts`:
   ```typescript
   // Generic events usable by any tool
   type CommonPipelineEvent =
     | HeaderEvent | StatusLineEvent | SummaryEvent | SectionEvent
     | DetailTreeEvent | TableEvent | FileRefEvent | NextStepsEvent;

   // Build/test-specific events
   type BuildTestPipelineEvent =
     | BuildStageEvent | CompilerWarningEvent | CompilerErrorEvent
     | TestDiscoveryEvent | TestProgressEvent | TestFailureEvent;

   // Full union (backward compatible)
   type PipelineEvent = CommonPipelineEvent | BuildTestPipelineEvent;
   ```
   This makes the boundary explicit without breaking any runtime code.

### Maybe do later (if duplication grows)

3. **Extract a tiny render-session helper** from the duplicated pattern between `toolResponse()` and `createXcodebuildPipeline()`:
   - Both call `resolveRenderers()`
   - Both fan out events to renderers
   - Both call `renderer.finalize()`
   - Both collect `mcpRenderer.getContent()`

   A ~20-line helper could eliminate this duplication if more entry points emerge.

4. **Consider renaming the pipeline** to `BuildOutputPipeline` or `BuildTestPipeline` to reflect that it handles `swift build/test/run` output too, not just `xcodebuild`.

### Do not do

5. **Do not build a generic `ToolOutputPipeline`** — there are zero consumers that need it. The `toolResponse()` function already serves the generic use case.

6. **Do not split parser/state/finalize into abstract interfaces** — there is only one implementation and no foreseeable second one.

## Preventive Measures

- When adding new streaming subprocess tools, evaluate whether they need the build pipeline's features (stage tracking, diagnostic dedup, summary synthesis). If not, `toolResponse()` with event builders is sufficient.
- If a second streaming parser ever emerges, *that* is the time to extract common infrastructure from the pipeline.
