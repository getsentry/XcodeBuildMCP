# Investigation: Snapshot CLI/MCP parity audit

## Summary
CLI vs MCP snapshot **scenario parity is mostly good**: there are no CLI fixture scenarios missing an MCP counterpart. The real problems are **transport fidelity** and one **runtime-state skew**. Specifically, CLI snapshot tests for some stateful tools are not exercising the real CLI path, and a few UI automation success cases run with different logical preconditions across runtimes.

## Symptoms
- MCP parity was previously incomplete and some MCP output drifted into CLI-style next steps.
- Snapshot harness logic recently regressed around simulator lookup and broader snapshot refactors raised concern about parity drift.
- We needed to verify that for every CLI snapshot scenario there is an equivalent MCP scenario, and that the captured command uses the correct runtime harness.

## Investigation Log

### Fixture corpus comparison
**Hypothesis:** Some CLI fixture scenarios may be missing MCP equivalents.

**Findings:** Programmatic fixture comparison shows **no CLI-only fixture files**. MCP has 7 additional fixtures, but all are intentional MCP-only cases.

**Evidence:**
- Programmatic comparison result:
  - `cliCount: 135`
  - `mcpCount: 142`
  - `onlyCli: []`
  - `onlyMcp:`
    - `resources/devices--success.txt`
    - `resources/doctor--success.txt`
    - `resources/session-status--success.txt`
    - `resources/simulators--success.txt`
    - `session-management/session-set-defaults--scheme.txt`
    - `session-management/session-show-defaults--empty.txt`
    - `simulator/build--error-missing-params.txt`
- Explicit MCP-only suite branches:
  - `src/snapshot-tests/suites/session-management-suite.ts:92`
  - `src/snapshot-tests/suites/simulator-suite.ts:246`
- Resources are MCP-only by test entry design; there is no CLI resources snapshot entry.

**Conclusion:** Confirmed: **1:1 fixture scenario parity exists for all CLI scenarios**. The fixture-count mismatch is explained by intentional MCP-only additions.

### Harness wiring audit
**Hypothesis:** Some snapshot suites may capture output through the wrong runtime path.

**Findings:** MCP harness wiring is correct, but the CLI harness has a direct-invoke fallback that bypasses the CLI subprocess path for `stateful` tools.

**Evidence:**
- `src/snapshot-tests/suites/helpers.ts:5-10`
  - `createHarnessForRuntime('mcp')` uses `createMcpSnapshotHarness()`
  - `createHarnessForRuntime('cli')` uses `createSnapshotHarness()`
- `src/snapshot-tests/mcp-harness.ts:71-122`
  - MCP snapshots use `client.callTool(...)` over stdio MCP transport.
- `src/snapshot-tests/harness.ts:89-101`
  - CLI harness resolves tool manifest and does:
  - `if (resolved.isMcpOnly || resolved.isStateful) { return invokeDirect(...) }`
- `src/snapshot-tests/harness.ts:116-142`
  - `invokeDirect(...)` renders with `postProcessSession(... runtime: 'mcp' ...)`
- `src/snapshot-tests/tool-manifest-resolver.ts:29-36`
  - `isStateful` is derived from `tool.routing?.stateful === true`

**Conclusion:** Confirmed: **CLI stateful-tool snapshots are not true CLI transport tests**. They bypass CLI execution and are post-processed as MCP text.

### Debugging workflow parity
**Hypothesis:** Debugging CLI fixtures are likely contaminated by the direct-invoke fallback.

**Findings:** The debugging suite is scenario-parity complete, but CLI fixtures prove MCP formatting leaked into CLI output.

**Evidence:**
- `manifests/tools/debug_attach_sim.yaml:7`
  - `routing.stateful: true`
- `src/snapshot-tests/suites/debugging-suite.ts:104-116`
  - main command under test is captured with `harness.invoke('debugging', 'attach', ...)`
- `src/snapshot-tests/__fixtures__/cli/debugging/attach--success.txt:9-11`
  - CLI fixture contains MCP-style next steps:
  - `debug_breakpoint_add({ ... })`
  - `debug_continue({ ... })`
  - `debug_stack({ ... })`

**Conclusion:** Confirmed: debugging has **scenario parity**, but CLI capture fidelity is broken for stateful commands.

### Swift package workflow parity
**Hypothesis:** Swift package stateful commands may also bypass real CLI capture.

**Findings:** The suite covers the same scenarios across runtimes, but several CLI scenarios are effectively in-process/stateful snapshots rather than real CLI transport tests.

**Evidence:**
- `manifests/tools/swift_package_run.yaml:7`
  - `routing.stateful: true`
- `manifests/tools/swift_package_list.yaml:7`
  - `routing.stateful: true`
- `manifests/tools/swift_package_stop.yaml:7`
  - `routing.stateful: true`
- `src/snapshot-tests/suites/swift-package-suite.ts:2`
  - suite imports `clearAllProcesses` directly from the active-process registry
- `src/snapshot-tests/suites/swift-package-suite.ts:102-136`
  - `list` and `stop` scenarios manipulate or rely on in-process process state
- `src/snapshot-tests/__fixtures__/cli/swift-package/stop--error-no-process.txt:5`
  - CLI fixture says: `Use swift_package_list to check active processes.`
  - This is MCP tool naming leaking into CLI output.

**Conclusion:** Confirmed: swift-package has **scenario parity**, but the CLI transport contract is wrong for stateful scenarios (`run`, `list`, `stop`).

### UI automation logical parity
**Hypothesis:** Some UI automation success cases may differ by runtime because MCP preserves session state while CLI does not.

**Findings:** The captured commands use the correct runtime harnesses, but four success scenarios run with different logical preconditions across runtimes.

**Evidence:**
- `src/snapshot-tests/suites/ui-automation-suite.ts:17-28`
  - suite reuses one harness per runtime and calls `simulator build-and-run` once in `beforeAll`
- `src/snapshot-tests/suites/ui-automation-suite.ts:31-46`
  - `snapshot-ui` runs early in the suite before coordinate-based actions
- `src/snapshot-tests/__fixtures__/cli/ui-automation/tap--success.txt:7`
  - CLI fixture includes warning:
  - `snapshot_ui has not been called yet`
- `src/snapshot-tests/__fixtures__/mcp/ui-automation/tap--success.txt:1-6`
  - MCP fixture does **not** include that warning
- By identical suite order plus persistent MCP harness state (`src/snapshot-tests/mcp-harness.ts:71-122`), MCP retains prior `snapshot-ui` state while CLI subprocess invocation does not.

**Conclusion:** Confirmed: `tap--success`, `touch--success`, `long-press--success`, and `swipe--success` are **not logically identical scenarios** across runtimes, even though both are captured through their intended harnesses.

## Root Cause
There are two distinct issues:

1. **Transport fidelity bug in CLI snapshot harness**
   - `src/snapshot-tests/harness.ts:89-101` routes `stateful` CLI tools to `invokeDirect(...)` instead of the real CLI subprocess path.
   - `src/snapshot-tests/harness.ts:129-134` then post-processes those snapshots as `runtime: 'mcp'`.
   - This causes CLI fixtures for stateful tools to capture MCP-style output, especially visible in debugging and swift-package fixtures.

2. **Runtime-state skew in UI automation suite ordering**
   - `src/snapshot-tests/suites/ui-automation-suite.ts` runs `snapshot-ui` before several coordinate-based action tests while reusing one harness per runtime.
   - Because the MCP harness is persistent and the CLI harness is subprocess-per-command, the same test order produces different preconditions.

These are separate from fixture-count parity. Fixture parity itself is largely correct.

## Recommendations
1. **Fix CLI transport capture for stateful tools**
   - File: `src/snapshot-tests/harness.ts`
   - Change CLI snapshot behavior so CLI-available tools always go through `invokeCli(...)`, even when `stateful`.
   - Only use direct invoke for truly MCP-only/internal cases if needed.

2. **Re-record affected CLI fixtures after transport fix**
   - At minimum:
     - `src/snapshot-tests/__fixtures__/cli/debugging/*` stateful scenarios
     - `src/snapshot-tests/__fixtures__/cli/swift-package/run--*.txt`
     - `src/snapshot-tests/__fixtures__/cli/swift-package/list--*.txt`
     - `src/snapshot-tests/__fixtures__/cli/swift-package/stop--error-no-process.txt`

3. **Restore logical parity in UI automation success cases**
   - File: `src/snapshot-tests/suites/ui-automation-suite.ts`
   - Minimal fix: move `snapshot-ui` success later, or otherwise ensure the four coordinate-based success scenarios run with the same `snapshot-ui` precondition across runtimes.

4. **Do not treat intentional MCP-only files as parity failures**
   - Resources workflow and the two explicit MCP-only suite branches are acceptable deltas.

## Preventive Measures
- Add a small assertion/helper in CLI snapshot harness tests that fails if a CLI fixture is generated through `invokeDirect(...)` for CLI-available tools.
- Keep parity checks focused on **registered suite scenarios**, not raw total fixture counts.
- When adding runtime-specific extras, keep them explicit in `if (runtime === 'mcp')` branches so parity audits remain simple.
