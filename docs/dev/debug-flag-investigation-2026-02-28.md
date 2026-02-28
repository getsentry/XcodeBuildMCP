# Investigation: DEBUG flag runtime behavior

## Summary
The `debug` flag is a runtime configuration value (from config/env/overrides), not a compile-time constant. Enabling it mainly changes **tool/workflow visibility** (doctor workflow + bridge debug tools), adds a limited **CLI daemon log-level override**, and tags telemetry context; it does **not** broadly switch core execution paths.

## Symptoms
- It was unclear whether `DEBUG` means logging-only or broader behavior changes.
- Docs mention debug logging and doctor exposure, but runtime impact was not clearly mapped end-to-end.

## Investigation Log

### 2026-02-28 / Phase 2 - Config source and precedence
**Hypothesis:** `debug` comes from multiple sources with precedence rules.
**Findings:** `debug` is parsed from `XCODEBUILDMCP_DEBUG`, accepted in config schema, and resolved via layered precedence: overrides > config file > env > defaults.
**Evidence:** `src/utils/config-store.ts:172`, `src/utils/config-store.ts:255-263`, `src/utils/config-store.ts:384`, `src/utils/runtime-config-schema.ts:9`, `src/utils/__tests__/config-store.test.ts:44-91`
**Conclusion:** Confirmed.

### 2026-02-28 / Phase 3 - Predicate wiring and exposure filtering
**Hypothesis:** `debug` drives predicate-based workflow/tool visibility.
**Findings:** `debugEnabled` predicate is `ctx.config.debug`; workflow and tool visibility both run predicate evaluation; MCP registration and CLI/daemon catalogs use that exposure filtering.
**Evidence:** `src/visibility/predicate-registry.ts:16`, `src/visibility/exposure.ts:39`, `src/visibility/exposure.ts:64`, `src/utils/tool-registry.ts:85`, `src/utils/tool-registry.ts:100`, `src/runtime/tool-catalog.ts:143`, `src/runtime/tool-catalog.ts:159`, `src/server/bootstrap.ts:84-91`, `src/visibility/__tests__/exposure.test.ts:86-112,273-328`, `src/visibility/__tests__/predicate-registry.test.ts:42-55`
**Conclusion:** Confirmed.

### 2026-02-28 / Phase 3 - Which workflows/tools are actually gated
**Hypothesis:** Only specific surfaces are debug-gated.
**Findings:**
- `doctor` workflow is `autoInclude: true` + `debugEnabled` predicate.
- `xcode_tools_bridge_{status,sync,disconnect}` tools are debug-gated.
- `xcode-ide` workflow itself is not debug-gated (uses `hideWhenXcodeAgentMode`).
**Evidence:** `manifests/workflows/doctor.yaml:5-8`, `manifests/tools/xcode_tools_bridge_status.yaml:7-8`, `manifests/tools/xcode_tools_bridge_sync.yaml:7-8`, `manifests/tools/xcode_tools_bridge_disconnect.yaml:7-8`, `manifests/workflows/xcode-ide.yaml:6-13`, `src/core/manifest/__tests__/load-manifest.test.ts:79-106`
**Conclusion:** Confirmed.

### 2026-02-28 / Phase 3 - Doctor tool vs doctor resource behavior
**Hypothesis:** DEBUG gates the doctor tool but not the doctor resource.
**Findings:**
- Tool `doctor` is attached to debug-gated `doctor` workflow.
- Resource registry includes `doctor` resource unconditionally.
- Doctor resource directly calls doctor logic without debug predicate check.
**Evidence:** `manifests/workflows/doctor.yaml:8-10`, `manifests/tools/doctor.yaml:1-9`, `src/core/resources.ts:39-43`, `src/core/resources.ts:79-103`, `src/mcp/resources/doctor.ts:19`, `src/mcp/resources/doctor.ts:64-71`
**Conclusion:** Confirmed.

### 2026-02-28 / Phase 3 - Logging and telemetry effects
**Hypothesis:** DEBUG also affects logging and telemetry context.
**Findings:**
- CLI passes `logLevel: 'info'` to daemon-backed bridge discovery when `config.debug` is true.
- That maps to env override `XCODEBUILDMCP_DAEMON_LOG_LEVEL`.
- MCP server log level defaults to `info` regardless of debug.
- MCP + daemon include `debugEnabled` in Sentry runtime context; Sentry stores it as tag `config.debug_enabled`.
**Evidence:** `src/cli.ts:136`, `src/cli/cli-tool-catalog.ts:57`, `src/server/start-mcp-server.ts:39`, `src/server/start-mcp-server.ts:67`, `src/daemon.ts:155`, `src/daemon.ts:211`, `src/utils/sentry.ts:219`
**Conclusion:** Confirmed (logging effect is scoped; telemetry effect is tagging only).

### 2026-02-28 / Phase 4 - Compile-time vs runtime mechanism
**Hypothesis:** There may be a compile-time DEBUG constant.
**Findings:** No `process.env.DEBUG`, no `debug` package usage, and no tsup `define` replacement for DEBUG; `debug` is runtime config plumbing.
**Evidence:** `tsup.config.ts:1-61`, `package.json:1-108`, repository search results for `process.env.DEBUG` and `from 'debug'` returned no matches.
**Conclusion:** Compile-time hypothesis eliminated.

### 2026-02-28 / Phase 4 - Historical drift and docs mismatch
**Hypothesis:** Some docs are stale relative to current predicate-based system.
**Findings:**
- `TOOL_DISCOVERY_LOGIC.md` still references `shouldExposeTool` and `src/utils/tool-visibility.ts` (not present in current src search).
- Current code uses predicate registry/exposure pipeline.
- Other docs phrase DEBUG as logging-only, which is incomplete (it also changes visibility and telemetry tags).
**Evidence:** `docs/dev/TOOL_DISCOVERY_LOGIC.md:47,75,105,116`, src search for `shouldExposeTool` returned no runtime matches, `docs/CONFIGURATION.md:191`, `server.json:52`, `docs/dev/CONTRIBUTING.md:223`, `src/visibility/predicate-registry.ts:16`, `src/visibility/exposure.ts:39-64`
**Conclusion:** Confirmed doc/code drift in at least one dev doc and minor wording incompleteness in public metadata/docs.

## Root Cause
`debug` is currently a **visibility/diagnostic feature flag** implemented via manifest predicates and runtime config layering. Confusion stems from mixed documentation language (often “debug logging”) while code uses `debug` for broader concerns: auto-including debug-gated workflows/tools and tagging runtime telemetry context.

## Eliminated Hypotheses
- **Compile-time DEBUG constant:** Eliminated (no bundler define/substitution path found).
- **Global behavior switch affecting core tool execution semantics:** Not supported by evidence; effects are primarily registration/visibility + scoped logging override + telemetry tag.

## Recommendations
1. Update docs to explicitly state that `debug` affects **tool/workflow exposure** in addition to diagnostics/logging wording.
2. Clarify in docs the distinction between:
   - debug-gated `doctor` **tool**
   - always-registered `xcodebuildmcp://doctor` **resource**
3. Update `docs/dev/TOOL_DISCOVERY_LOGIC.md` to current predicate-based architecture (remove stale `shouldExposeTool` references).
4. If desired product behavior is logging-only, decouple visibility gating from `debug` into a separately named config flag.

## Preventive Measures
- Add/maintain a single “DEBUG semantics” section in `docs/CONFIGURATION.md` and link it from `server.json` description text.
- Add a doc consistency test or lint check for known-removed APIs/paths (`shouldExposeTool`, `tool-visibility.ts`).
- Keep manifest predicate changes paired with docs updates in the same PR checklist.
