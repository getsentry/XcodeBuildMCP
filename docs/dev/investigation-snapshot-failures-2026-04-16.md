# Investigation: Snapshot Test Failures Post-Refactor

## Summary

6 snapshot test failures traced to 3 root causes: (1) `ensureNamedSimulatorStates` added in commit `1e60b101` boots up to 5 named simulators with no teardown, causing resource exhaustion and cross-suite state contamination; (2) device test invocations stall because the host environment is saturated by booted simulators from prior suites; (3) swift-package JSON diagnostics may be empty in MCP path due to a difference in how structured output captures fallback errors.

## Symptoms

1. Device test CLI/MCP: output truncated after test discovery — missing test failures, summary, build log
2. Device test JSON: 300s timeout
3. Simulator-management open JSON: Launch Services -1712 error
4. Simulator test JSON: parity mismatch
5. Swift-package build error JSON: empty diagnostics.errors
6. 5 simulators booted when only 1 should be

## Root Cause 1: Simulator State Contamination (Failures #3, #4, #6)

### Evidence

`ensureNamedSimulatorStates` was added in commit `1e60b101` and did NOT exist pre-refactor:

```
git show 9fbdebf6:src/snapshot-tests/harness.ts | grep -c "ensureNamedSimulatorStates"
# Returns: 0
```

Three suites now boot multiple named simulators:

- `simulator-management-suite.ts` line 34: boots iPhone 17 Pro, 17 Pro Max, 17e, Air, 17
- `simulator-suite.ts` line 182: boots iPhone 17 Pro, 17 Pro Max
- `resources-suite.ts` line 38: boots ALL 5 (iPhone 17 Pro, 17 Pro Max, 17e, Air, 17)

No suite restores baseline state. With `maxThreads: 1` in `vitest.snapshot.config.ts`, suites run sequentially and share host state.

### Impact

- **Failure #6**: 5 booted simulators is directly caused by resources-suite booting all 5
- **Failure #3**: Launch Services -1712 for `open_sim` is caused by Simulator.app resource contention with 5 booted sims
- **Failure #4**: Simulator test JSON mismatch because the test environment state differs from when the fixture was hand-crafted

### Fix

Remove `ensureNamedSimulatorStates` and all multi-simulator boot calls. Restore the pre-refactor approach:
- Use `ensureSimulatorBooted('iPhone 17')` for the primary test simulator
- Use `createTemporarySimulator` for throwaway tests (boot, erase)
- List tests should use deterministic mock data or accept normalized output, not force real simulator states

## Root Cause 2: Device Test Stall from Resource Exhaustion (Failures #1, #2)

### Evidence

Direct CLI run produces full correct output in 6-30 seconds:
```
node build/cli.js device test --json '{"workspacePath":"...","scheme":"CalculatorApp","deviceId":"33689F72-..."}' 2>/dev/null | wc -l
# Returns: 33 (full output)
```

spawnSync simulation also produces full output:
```
STATUS: 1, SIGNAL: null, STDOUT LINES: 34
```

But the snapshot test run only gets output up to test discovery. This means the xcodebuild invocation stalls during execution — likely because:
- Multiple booted simulators from earlier suites consume system resources
- CoreSimulator is busy managing 5 active simulators
- Device communication competes with simulator I/O

The test discovery is emitted before `executeXcodeBuildCommand` starts the actual test run. The truncation happens because the test run itself stalls or takes too long.

### Impact

- **Failure #1**: CLI device test output truncated
- **Failure #2**: MCP/JSON device test timeout at 300s

### Fix

Fixing Root Cause 1 (no multi-simulator booting) will likely resolve this. Only iPhone 17 should be booted for the primary test simulator. The device test should have ample resources.

## Root Cause 3: Swift-Package JSON Diagnostics (Failure #5)

### Evidence

CLI `--output json` produces correct diagnostics:
```json
"diagnostics": {
  "errors": [{"message": "chdir error: No such file or directory (2): ..."}]
}
```

**When run in isolation, the JSON parity test PASSES.** The failure only occurs in the full suite run. This confirms it's cross-suite state contamination, not a code bug.

The MCP and CLI paths use the same tool handler, same executor, same domain result builder. The diagnostics fallback logic (`collectFallbackDiagnosticEntries`) is independent of `liveProgressEnabled`. Static code analysis confirmed no MCP-specific diagnostic loss path exists.

The failure in the full suite is caused by daemon state contamination from earlier test suites — the same pattern as the swift-package `list` stale processes issue. When the daemon has stale state, the tool execution environment differs, potentially causing the xcodebuild command to produce different error output.

### Fix

Fixing Root Cause 1 (simulator state contamination + proper daemon cleanup between suites) will resolve this. No code change needed in the diagnostic extraction path.

## Recommendations

1. **Remove `ensureNamedSimulatorStates` and all multi-simulator boot orchestration** — revert to pre-refactor approach of single booted sim + temporary sims for throwaway tests
2. **Remove `ensureSimulatorState` function** — it was not in the pre-refactor code
3. **Keep `ensureSimulatorBooted`** but only for iPhone 17 (the primary test sim)
4. **For list snapshot tests** — either accept that list output is environment-dependent and normalize it, or skip those tests (as they were pre-refactor)
5. **Investigate swift-package MCP diagnostic capture** — may need to ensure fallback errors are captured in the MCP execution path
6. **Add afterAll cleanup** to any suite that modifies simulator state

## Preventive Measures

- Never boot real named simulators in snapshot tests — use temporary simulators for isolation
- Each suite should clean up any state it creates
- Add a global afterAll that shuts down any simulators booted during the test run
- Validate snapshot tests pass on a clean environment before merging
