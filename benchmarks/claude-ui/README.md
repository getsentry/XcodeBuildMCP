# Claude UI benchmark harness

Local/manual harness for running Claude Code against the development XcodeBuildMCP MCP server and auditing UI automation behavior.

The harness:

- reads a suite YAML file from `benchmarks/claude-ui/suites/`
- reads the referenced prompt Markdown file from disk and feeds it to `claude -p`
- creates, boots, waits for, and opens a fresh temporary simulator before Claude launches for each suite run by default
- writes an isolated per-run MCP workspace config with the suite defaults and temporary `simulatorId`
- generates a Claude MCP config pointing at `node build/cli.js mcp` with `XCODEBUILDMCP_CWD` set to that isolated workspace
- optionally preflights configured first-run prompts before Claude launches, outside the measured run
- deletes the temporary simulator at the end of the suite, best effort, using only the ID created by the harness
- writes artifacts under `out.nosync/claude-benchmarks/<suite>/<timestamp>/`
- runs the bundled `parse_claude_conversation.py` parser against Claude's stream JSONL
- audits tool counts, MCP calls, UI automation calls, wall clock, failures/stumbles, and expected tool sequence drift
- prints a structured per-suite report and (for `--all`) an aggregate summary
- optionally prints machine-readable JSON with `--json`
- can render an existing `result.json` or artifact directory with `--from-result` without rerunning Claude

This is intentionally not part of the normal test suite because it launches Claude and drives local simulators/apps.

## Commands

Build first, then run a suite:

```bash
npm run build
npx tsx benchmarks/claude-ui/run.ts --suite weather
```

Shortcut:

```bash
npm run bench:claude-ui -- --suite weather
```

Run every suite YAML:

```bash
npm run bench:claude-ui -- --all
```

Print machine-readable output from a new run:

```bash
npm run bench:claude-ui -- --suite reminders --json
```

Render an existing result without rerunning Claude:

```bash
npm run bench:claude-ui -- --from-result out.nosync/claude-benchmarks/reminders/20260522T130926Z
npm run bench:claude-ui -- --from-result out.nosync/claude-benchmarks/reminders/20260522T130926Z/result.json --json
```

New runs use the bundled parser at `benchmarks/claude-ui/parse_claude_conversation.py`. Pass `--parser /path/to/parse_claude_conversation.py` or set `CLAUDE_UI_BENCHMARK_PARSER` only when testing a different parser. `--from-result` does not need a parser because it only re-renders existing artifacts.

## Suite YAML shape

```yaml
name: weather
prompt: ../prompts/weather.md
workingDirectory: example_projects/Weather
sessionDefaults:
  projectPath: Weather.xcodeproj
  scheme: Weather
  simulatorName: iPhone 17 Pro Max
temporarySimulator: true
firstRunPromptDismissals:
  labels:
    - Continue
    - Not Now
  timeoutSeconds: 12
baseline:
  totalToolCalls: 19
  mcpToolCalls: 18
  uiAutomationCalls: 16
  wallClockSeconds: 125
  tools:
    snapshot_ui: 1
    tap: 9
allowedVariance:
  totalToolCalls: 2
  mcpToolCalls: 2
  uiAutomationCalls: 2
  wallClockSeconds: 45
  toolCalls: 2
expectedToolSequence:
  - session_show_defaults
  - build_run_sim
  - snapshot_ui
sequence:
  mode: warn
failurePatterns:
  - STALE_ELEMENT_REF
  - SNAPSHOT_MISSING
  - WAIT_TIMEOUT
```

Variance is an upper bound: lower tool counts or faster runs are accepted, while values above `baseline + allowedVariance` fail. Defaults are `totalToolCalls: 0`, `mcpToolCalls: 0`, `uiAutomationCalls: 0`, `toolCalls: 0`, and `wallClockSeconds: 30`.

Tool sequence drift is warning-only by default (`sequence.mode: warn`) because real Claude runs can choose equally valid UI paths. Use `sequence.mode: fail` only for suites where exact MCP call order is part of the contract.

`sessionDefaults` are written to a harness-owned config at `<run>/mcp-workspace/.xcodebuildmcp/config.yaml`. The generated Claude MCP config sets `XCODEBUILDMCP_CWD` to `<run>/mcp-workspace`, so the dev MCP server reads only the benchmark config instead of any repo or example-project `.xcodebuildmcp/config.yaml`. Unknown keys fail fast. Relative path defaults such as `projectPath`, `workspacePath`, and `derivedDataPath` are resolved against the suite `workingDirectory` before being written because the MCP server cwd is the isolated workspace.

## Temporary simulator lifecycle

By default, each suite creates a fresh simulator before Claude launches. The harness uses `sessionDefaults.simulatorName` as the `simctl create` device type name, captures the returned simulator ID, boots that simulator, waits for `simctl bootstatus <id> -b`, opens Simulator.app to that device, applies a short UI-readiness delay, and writes the simulator ID as `sessionDefaults.simulatorId` in the isolated MCP workspace config. This makes Claude and the dev MCP server target a visible, booted, isolated simulator instead of reusing a previous run's state or spending benchmark calls on simulator boot/open setup.

Simulator setup is deliberately outside the benchmark measurement boundary. The measured `wallClockSeconds` starts when the harness spawns Claude and stops when Claude exits. Tool-call counts are parsed only from Claude's JSONL transcript. The result JSON still records temporary simulator `setupDurationSeconds` under `run.temporarySimulator` so setup cost is visible without being compared against Claude task-efficiency baselines.

Config contract:

- Omit `temporarySimulator` for the default behavior: create and later delete a temporary simulator.
- Set `temporarySimulator: false` to opt out and use the suite/project defaults as-is.
- Set `sessionDefaults.simulatorId` to use an existing simulator. In this case the harness does not create or delete a simulator.
- Do not set both `temporarySimulator: true` and `sessionDefaults.simulatorId`; the harness fails fast because deleting a user-provided simulator would be unsafe.

Temporary simulator setup is required when enabled. If creation, boot, bootstatus, or Simulator.app opening fails, the suite fails loudly before Claude starts. Deletion is best effort in a `finally` block: failures are logged but do not mask the benchmark result or original error.

`firstRunPromptDismissals` is an optional suite-level preflight for fresh simulator noise such as Apple first-run sheets. When configured, the harness launches `sessionDefaults.bundleId` before Claude starts, retries through transient UI-inspection failures, looks for any listed button labels, taps matching labels with AXe, then terminates the app. If the prompt state cannot be inspected or dismissed before `timeoutSeconds`, the suite fails before Claude starts. These preflight interactions are logged in `simulator-lifecycle.log`, but they are outside Claude's wall-clock measurement and do not appear in tool-call counts. Keep the labels generic and non-destructive, for example `Continue`, `Not Now`, or `OK`; do not configure sign-in, sync enablement, Settings, destructive, or data-deletion actions.

Lifecycle details are written to `simulator-lifecycle.log`, including the `create`, `boot`, `bootstatus`, `open`, readiness delay, optional first-run prompt preflight, and deletion steps. `claude-command.log` also records the simulator ID used for the run. The terminal report shows the temporary simulator ID plus setup duration as `setup ... before Claude` when a temporary simulator is used.

## Terminal report

Each suite renders as a structured report with a status banner, aligned metric and tool tables, a failures/stumbles section (only when non-zero), and a sequence diff. When run with `--all`, an aggregate summary follows the per-suite reports.

### Single suite

```text
────────────────────────────────────────────────────────────────────────
PASS  weather                                                   1m 38.6s
  suite     benchmarks/claude-ui/suites/weather.yml
  artifacts out.nosync/claude-benchmarks/weather/20260522T214044Z
  exit      claude=0 parser=0

Metrics
  METRIC             ACTUAL  BASELINE  VARIANCE   DELTA  STATUS
  totalToolCalls         13        19        +2      −6  PASS
  mcpToolCalls           12        18        +2      −6  PASS
  uiAutomationCalls      10        16        +2      −6  PASS
  wallClockSeconds    98.62    125.00    +45.00  −26.38  PASS

Tool calls (baseline-tracked)
  TOOL                   ACTUAL  BASELINE  DELTA  STATUS
  session_show_defaults       1         1      0  PASS
  build_run_sim               1         1      0  PASS
  snapshot_ui                 1         1      0  PASS
  tap                         6         9     −3  PASS
  batch                       1         1      0  PASS

PASS  failures/stumbles: 0
```

### Sequence drift

When the tool sequence drifts, the report includes unified-diff style hunks with expected/actual index columns. Drift is warning-only by default, so the overall status stays `WARN` rather than `FAIL`:

```text
WARN  tool sequence (warn): drift: 4 missing, 0 additional
  @@ expected[8..15] actual[8..11] @@
        8    8    tap
        9    9    tap
       10       − tap
       11   10    swipe
       12   11    tap
       13       − swipe
       14       − tap
       15       − tap
```

`−` lines are expected calls Claude skipped; `+` lines are calls Claude made that were not expected. Dim lines are surrounding context.

### Failures and inspect hints

When `failures/stumbles` is non-zero the report lists the first few tool failures and pattern matches, and surfaces an `Inspect` block with the relevant artifact paths:

```text
FAIL  failures/stumbles: 1
  • tool failures: 1
      boot_sim @ line 9: Boot failed: device not found

Inspect
  result.json   out.nosync/claude-benchmarks/reminders/20260522T213905Z/result.json
  transcript    out.nosync/claude-benchmarks/reminders/20260522T213905Z/claude.jsonl
  stderr        out.nosync/claude-benchmarks/reminders/20260522T213905Z/claude.stderr
  run dir       out.nosync/claude-benchmarks/reminders/20260522T213905Z
```

### Aggregate summary

After `--all` (or multi-result `--from-result`) the harness appends:

```text
════════════════════════════════════════════════════════════════════════
  Claude UI Benchmarks · Summary
════════════════════════════════════════════════════════════════════════
  Suites:    3 total · 2 passed · 1 failed · 2 sequence warnings
  Duration:  total 4m 49.8s · slowest reminders (1m 39.8s)
  Artifacts: out.nosync/claude-benchmarks/

  ! WARN  weather    1m 38.6s  sequence warn: 4m/0a
  ✗ FAIL  reminders  1m 39.8s  1 stumble · sequence warn: 7m/4a
  ! WARN  contacts   1m 31.4s  sequence warn: 2m/2a
════════════════════════════════════════════════════════════════════════
```

`Nm/Ka` denotes "N missing / K additional" calls vs. `expectedToolSequence`.

The renderer auto-detects TTY and adds ANSI color when stdout is a terminal and `NO_COLOR` is unset. Plain-text output (e.g. when piping to a file or under `NO_COLOR=1`) carries the same information without color codes.

`--json` output is unchanged by this renderer: the JSON payload remains a single `BenchmarkResult` for `--suite` / single-result `--from-result`, and an array for `--all` / multi-result `--from-result`.

## Artifacts

Each run writes:

- `prompt.md` — exact suite prompt fed to Claude
- `mcp-config.json` — generated Claude MCP config
- `mcp-workspace/.xcodebuildmcp/config.yaml` — isolated MCP server config with effective suite defaults
- `claude.jsonl` — Claude stream JSON output
- `claude.stderr` — Claude stderr
- `claude-command.log` — command, cwd, simulator ID, exit status, wall clock
- `simulator-lifecycle.log` — temporary simulator create, boot, bootstatus, open, readiness, deletion commands, and simulator ID
- `parsed/` — files written by `parse_claude_conversation.py`
- `parse.log` / `parse.log.stderr` — parser output
- `result.json` — full benchmark result
