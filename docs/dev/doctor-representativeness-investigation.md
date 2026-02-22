# Investigation: Doctor Tool Representativeness Audit

## Summary
`doctor` is partially representative, but it has material drift in dependency modeling, runtime/workflow accuracy, and messaging. The biggest issues are false-green/false-red states and one side-effecting check (`xcodemake`) inside a diagnostic command.

## Symptoms
- Concern that `doctor` output no longer matches current manifest-driven tool/workflow architecture.
- Concern that workflow/environment/dependency checks are incomplete or misleading.

## Investigation Log

### Phase 1 - Initial assessment
**Hypothesis:** Doctor may have drifted from implementation after manifest/runtime refactors.
**Findings:** Doctor report is assembled from mixed sources (static manifest summaries + runtime registry snapshots + ad-hoc binary checks).
**Evidence:** `src/mcp/tools/doctor/doctor.ts:102-141`, `src/mcp/tools/doctor/lib/doctor.deps.ts:217-251`
**Conclusion:** Confirmed; this mixed model introduces representativeness gaps.

### Phase 2 - Core doctor behavior audit
**Hypothesis:** Doctor schema and output include stale/unused behavior.
**Findings:** `enabled` exists in schema and tests but is not used by logic.
**Evidence:** `src/mcp/tools/doctor/doctor.ts:24-26`, `src/mcp/tools/doctor/doctor.ts:102-137`, `src/mcp/tools/doctor/__tests__/doctor.test.ts:131-140`
**Conclusion:** Confirmed stale surface area.

### Phase 3 - Dependency and feature checks
**Hypothesis:** Dependency checks are not aligned with runtime behavior.
**Findings:**
- Doctor hardcodes `['axe','xcodemake','mise']` for dependencies.
- Doctor calls `isXcodemakeAvailable()` which can download/install xcodemake (side effect).
- Doctor reports UI automation as supported if AXe exists, but video capture requires AXe >= 1.1.0.
**Evidence:**
- `src/mcp/tools/doctor/doctor.ts:107-111`
- `src/mcp/tools/doctor/doctor.ts:127-130`
- `src/utils/xcodemake.ts:90-105`, `src/utils/xcodemake.ts:156-157`
- `src/mcp/tools/doctor/doctor.ts:288-292`
- `src/mcp/tools/simulator/record_sim_video.ts:81-84`
**Conclusion:** Confirmed false-green/false-red and side-effect risk.

### Phase 4 - Workflow/runtime representativeness
**Hypothesis:** Doctor's tool/workflow summaries do not match actual runtime exposure rules.
**Findings:**
- Plugin summary totals are derived from manifest workflow memberships, not runtime predicate-filtered exposure.
- Runtime registration can be unavailable (doctor prints note) when registry wasn't initialized.
- CLI doctor invokes `doctorLogic` directly without runtime bootstrap.
**Evidence:**
- `src/mcp/tools/doctor/lib/doctor.deps.ts:224-236`
- `src/utils/tool-registry.ts:36-44`, `src/utils/tool-registry.ts:84-102`
- `src/mcp/tools/doctor/doctor.ts:120-127`
- `src/doctor-cli.ts:20-23`
**Conclusion:** Confirmed reporting mismatch between manifest inventory and live exposure/registration.

### Phase 5 - Bridge and docs consistency
**Hypothesis:** Xcode IDE bridge docs and doctor/workflow behavior are inconsistent.
**Findings:**
- Docs claim gateway tools are shown only when `mcpbridge` is available.
- Tool manifests only require `mcpRuntimeOnly` (not bridge availability).
- Runtime actually fails at call-time when `mcpbridge` is missing.
**Evidence:**
- `docs/XCODE_IDE_MCPBRIDGE.md:25`
- `manifests/tools/xcode_ide_list_tools.yaml:7-8`, `manifests/tools/xcode_ide_call_tool.yaml:7-8`
- `src/integrations/xcode-tools-bridge/tool-service.ts:145-149`
**Conclusion:** Confirmed docs/runtime mismatch.

### Phase 6 - Environment and test coverage
**Hypothesis:** Doctor env reporting and tests may not cover current config surface.
**Findings:**
- Doctor env list is partially hardcoded + `XCODEBUILDMCP_*` prefix scan.
- Config also reads non-prefix env inputs (for example `AXE_PATH`, `XBMCP_LAUNCH_JSON_WAIT_MS`) not explicitly surfaced as first-class doctor checks.
- Doctor tests mostly assert text existence/type instead of semantic correctness.
**Evidence:**
- `src/mcp/tools/doctor/lib/doctor.deps.ts:164-184`
- `src/utils/config-store.ts:197-198`, `src/utils/config-store.ts:224`
- `src/mcp/tools/doctor/__tests__/doctor.test.ts:152`, `:172`, `:191`, `:217`, `:283`
**Conclusion:** Confirmed gaps in report fidelity and regression safety.

### Phase 7 - History check
**Hypothesis:** Recent architecture/tool changes may have outpaced doctor updates.
**Findings:**
- Large manifest/runtime refactor landed (`907cfe3c`, Feb 4, 2026).
- xcode-ide/gating changes landed (`9b182d46`, Feb 5, 2026; `898819b9`, Feb 15, 2026).
- Doctor changed during this period but still retains mismatches above.
**Evidence:** Git history via `git log/show` on doctor, manifests, and xcode-ide files.
**Conclusion:** Drift is plausible and observable post-refactor.

## Root Cause
Doctor currently blends multiple data models with different semantics:
1. **Static manifest inventory** (workflow membership totals)
2. **Live runtime registry snapshot** (only after registration runs)
3. **Direct environment/binary probes** (including side-effecting xcodemake path)

Because these sources are not normalized into one explicit capability model, the output can be internally inconsistent and not fully representative of what tools will actually work in the current runtime/context.

## Eliminated Hypotheses
- **"Doctor is totally disconnected from current manifests"**: eliminated. It does read manifests (`doctor.deps.ts:220-236`).
- **"Doctor has no bridge visibility"**: eliminated. It does report bridge status and proxied count (`doctor.ts:329-340`).
- **"No recent doctor maintenance"**: eliminated. Doctor-related files changed during Feb 2026 refactors.

## Recommendations
1. **Make doctor read-only (P0)**
   - Replace `isXcodemakeAvailable()` usage in doctor with side-effect-free `isXcodemakeBinaryAvailable()`.
   - Keep auto-install behavior in build execution paths, not diagnostics.

2. **Separate inventory/exposure/registration views (P0)**
   - Report 3 explicit counts:
     - Manifest inventory
     - Exposed under current predicate context
     - Actually registered now
   - Avoid presenting manifest totals as runtime availability.

3. **Capability-based dependency checks (P1)**
   - Gate checks by enabled workflows + selected backend/config.
   - Add AXe version capability check for video capture (`>=1.1.0`).
   - Add explicit bridge dependency health to gateway-tool readiness section.

4. **Fix docs/runtime inconsistencies (P1)**
   - Correct `docs/XCODE_IDE_MCPBRIDGE.md` claim about visibility on `mcpbridge` availability, or add a predicate/system that enforces that claim.
   - Adjust `docs/TROUBLESHOOTING.md` wording (“all dependencies required”) to reflect scope-based checks.

5. **Improve env and workflow-management visibility (P2)**
   - Surface key non-prefix env vars that materially alter runtime behavior (for example `AXE_PATH`, `XBMCP_LAUNCH_JSON_WAIT_MS`).
   - Include current predicate context summary (runtime/debug/runningUnderXcode) so workflow results are explainable.

6. **Strengthen tests (P2)**
   - Add semantic assertions (specific sections/flags/warnings) instead of mostly `typeof text === 'string'`.
   - Add regression tests for false-green/false-red scenarios (AXe version mismatch, xcodemake unavailable but disabled, runtime registry missing).

## Preventive Measures
- Define a typed internal "doctor capability model" (single source for checks and statuses) and render output from that model only.
- Add contract tests that compare doctor output against manifest/runtime predicate expectations for known fixture configs.
- Add CI check to fail if docs claims about tool visibility/dependencies contradict manifest predicates or runtime gating behavior.
