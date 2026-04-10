# Simulator test benchmark

This benchmark compares XcodeBuildMCP's simulator test command against Flowdeck CLI using the Calculator example project in the current worktree.

## Prerequisites

- `npm install`
- `npm run build`
- `flowdeck` available on `PATH`
- An `iPhone 17 Pro` simulator installed
- `/usr/bin/script` available (required so both tools run under a PTY and stream live progress)

## Command

```bash
npm run bench:test-sim -- --iterations 1 --mode warm
```

Options:

- `--iterations <n>`: repeat both tools `n` times
- `--mode warm|cold`: reuse or clear benchmark-owned derived data before each run

## Exact commands used

XcodeBuildMCP:

```bash
./build/cli.js simulator test --json '{"workspacePath":"<repo>/example_projects/iOS_Calculator/CalculatorApp.xcworkspace","scheme":"CalculatorApp","simulatorName":"iPhone 17 Pro","useLatestOS":true,"extraArgs":["-only-testing:CalculatorAppTests"],"progress":true,"derivedDataPath":"<artifact-dir>/derived-data-xcodebuildmcp"}' --output text
```

Flowdeck CLI:

```bash
flowdeck test -w <repo>/example_projects/iOS_Calculator/CalculatorApp.xcworkspace -s CalculatorApp -S "iPhone 17 Pro" --only CalculatorAppTests --progress -d <artifact-dir>/derived-data-flowdeck
```

Both commands are executed through `/usr/bin/script -q /dev/null ...` so the benchmark measures the real TTY streaming path instead of a buffered pipe.

## Output

Artifacts are written to:

```text
benchmarks/simulator-test/<timestamp>/
```

Each run writes:

- `summary.json`
- `xcodebuildmcp-run-*.stdout.txt`
- `xcodebuildmcp-run-*.stderr.txt`
- `flowdeck-run-*.stdout.txt`
- `flowdeck-run-*.stderr.txt`

Captured metrics:

- wall-clock duration
- time to first stdout
- time to first milestone output
- time to first streamed test progress output
- exit code

Transcripts are normalized before saving:

- ANSI escapes are stripped
- carriage returns are converted to newlines
- PTY control characters are removed

## Manual compile-error fixture

To manually compare compile-failure output styling against Flowdeck without keeping the example project permanently broken:

```bash
cp example_projects/iOS_Calculator/manual-fixtures/CalculatorAppTests/CompileError.fixture.swift \
  example_projects/iOS_Calculator/CalculatorAppTests/CompileError.swift
```

Then rerun the simulator test command in both tools. When finished, remove the copied file:

```bash
rm example_projects/iOS_Calculator/CalculatorAppTests/CompileError.swift
```
