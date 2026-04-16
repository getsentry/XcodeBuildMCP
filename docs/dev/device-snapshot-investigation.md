# Investigation: Device snapshot regressions

## Summary
The strongest current evidence points to an Apple tooling issue in the post-test device diagnostics path, not a deterministic regression in XcodeBuildMCP’s shared device workflow code. After a failing physical-device `xcodebuild test`, Xcode launches `devicectl diagnose`; when that runs on a TTY it prints `Password:` and blocks on interactive input, and when Xcode launches it from a background TTY process group the subprocess gets wedged. In non-TTY mode, the same path does not hang and instead exits with a concrete `CoreDeviceCLISupport.DiagnoseError` / `No provider was found` failure.

## Symptoms
- CLI `device build-and-run` success case returned `isError === true` in the snapshot suite.
- CLI `device test` intentional failure snapshot was truncated after discovery/build-stage output and did not include the expected failure footer.
- MCP `device test` intentional failure timed out after 300s in the suite.

## Investigation Log

### Initial assessment
**Hypothesis:** A refactor changed shared device workflow behavior, likely in long-running command/result streaming or failure parsing.
**Findings:** Targeted device test still passes, which suggests device discovery/build bootstrapping still works. Failures are concentrated in `build-and-run` and full-suite `test` failure handling.
**Evidence:** `XcodeBuildMCP/src/snapshot-tests/suites/device-suite.ts:13-211`
**Conclusion:** Needed broader context and direct reproductions.

### Broad code-path review
**Hypothesis:** Shared test/build code or transport handling regressed.
**Findings:** The device suite and entrypoint are effectively unchanged from `main`; the meaningful snapshot-harness changes vs `main` are timeout increases and normalization/MCP envelope handling, not device workflow logic.
**Evidence:**
- `src/snapshot-tests/suites/device-suite.ts` is unchanged in substance versus `main`.
- `src/snapshot-tests/__tests__/device.snapshot.test.ts` is unchanged versus `main`.
- `src/snapshot-tests/harness.ts:8-36` increased CLI snapshot timeout from `120000` to `300000`.
- `src/snapshot-tests/mcp-harness.ts:9-13,93-105` increased MCP timeout from `120000` to `300000` and now prefers `structuredEnvelope.didError`.
- `src/snapshot-tests/normalize.ts` changes are normalization-only.
**Conclusion:** The reported failures are not explained by a direct diff in the device suite itself.

### CLI `build-and-run` direct reproduction
**Hypothesis:** CLI is falsely classifying a successful build-and-run as an error because of render-session error latching.
**Findings:** Isolated `device build-and-run` really failed on the first run. The exit code was `1`, and the output contained a real `devicectl` install failure:
- `Unable to Install “Calculator”`
- `ApplicationVerificationFailed`
- `No code signature found`
A second immediate rerun succeeded with exit code `0`.
**Evidence:**
- Direct run exit code capture: `/tmp/build-run.rc` contained `1`.
- Direct run output: `/tmp/build-run.out` contained the `devicectl` install failure text.
- Immediate rerun: `/tmp/build-run-2.rc` contained `0` and `/tmp/build-run-2.out` showed a complete success transcript.
- The failed build log still ended with successful signing and `** BUILD SUCCEEDED **`: `/Users/cameroncooke/Library/Developer/XcodeBuildMCP/logs/build_run_device_2026-04-16T19-59-14-443Z_pid38742.log`.
**Conclusion:** This is not primarily a false CLI `isError` classification bug. The combined flow hit a genuine but flaky device-side install failure.

### Build artifact validation after failed `build-and-run`
**Hypothesis:** The refactor produced an actually unsigned app artifact.
**Findings:** The app at the resolved path was signed correctly, and a direct `device install` of that same app path succeeded.
**Evidence:**
- `device get-app-path` succeeded and pointed to `~/Library/Developer/XcodeBuildMCP/DerivedData/Build/Products/Debug-iphoneos/CalculatorApp.app`.
- `xcrun codesign -dvvv` against that app showed a valid Apple Development signature, team identifier, `_CodeSignature`, and `embedded.mobileprovision`.
- Direct install succeeded with exit code `0` and output `✅ App installed successfully.` in `/tmp/install-device.out`.
**Conclusion:** The artifact itself was valid. The first `build-and-run` failure is best explained as transient `devicectl` / physical-device install flakiness, not a deterministic signing regression in the build step.

### Fresh DerivedData isolation
**Hypothesis:** Shared default DerivedData corruption is causing the `build-and-run` failure deterministically.
**Findings:** Running `device build-and-run` with a fresh temporary `derivedDataPath` succeeded on the first try.
**Evidence:** `/tmp/fresh-build-run.rc` contained `0`; `/tmp/fresh-build-run.out` contained a full success transcript.
**Conclusion:** There is no evidence of a deterministic combined-flow failure tied solely to the current implementation. The failure is transient/stateful.

### Direct device-test reproductions
**Hypothesis:** `test-common.ts`, parser/finalization code, or CLI/MCP transport handling regressed for failing device tests.
**Findings:** The failing full-device test works normally in isolation and in focused back-to-back runs.
**Evidence:**
- Direct CLI full failing test exited `1` and completed in about 10s with the full footer in `/tmp/device-test.out`.
- Back-to-back direct CLI runs (targeted pass, then full fail) completed normally: `targeted rc=0 dur=8.7s`, `fullfail rc=1 dur=6.8s`.
- Back-to-back snapshot MCP harness calls also completed normally: targeted `isError:false` in ~9.2s, full fail `isError:true` in ~6.1s.
**Conclusion:** The underlying device-test code path is not deterministically broken. The suite-only failure requires a broader state/order interaction.

### Post-test diagnostics reverse engineering
**Hypothesis:** The hang happens after test execution, in Apple’s diagnostics collection path rather than in XcodeBuildMCP parsing/rendering.
**Findings:** That hypothesis is confirmed.
**Evidence:**
- Raw PTY-backed `xcodebuild test` reproduced the exact symptom and captured `Password:` immediately after the final XCTest summary in `/tmp/pty-xcodebuild-test.typescript`.
- During that stall, the live child process was:
  - `/Library/Developer/PrivateFrameworks/CoreDevice.framework/Versions/A/Resources/bin/devicectl diagnose --devices 00008140-000278A438E3C01C --no-finder --archive-destination ... --timeout 600`
- Process state showed `devicectl` was running in its own process group on the same TTY, but **not** the foreground TTY process group:
  - `pgid=15787`, `tpgid=15723`, `state=T`
- That means the subprocess was stopped after attempting terminal interaction from a background TTY process group.
- Running the same `xcodebuild test` command **without** a TTY did not hang. It completed and printed Xcode’s own diagnostic failure text:
  - `Failure collecting diagnostics from devices`
  - `No provider was found`
  - `CoreDeviceCLISupport.DiagnoseError error 0`
- Running `devicectl diagnose` directly under a PTY, with no `xcodebuild` involved, reproduced the same interactive path in `/tmp/pty-devicectl-diagnose.typescript`:
  - provisioning/provider error text
  - Apple privacy notice
  - `Password:`
  - sending a blank line produced `Sorry, try again.` and another `Password:` prompt
- Running `devicectl diagnose` directly **without** a TTY did not prompt; it failed fast and wrote a partial bundle.
**Conclusion:** The bad path is in Apple’s `devicectl diagnose` TTY behavior. `xcodebuild` makes it worse by launching that interactive subprocess from a background terminal process group, which wedges the run.

## Root Cause
The root cause of the hang is Apple’s post-test diagnostics flow for failing physical-device tests:

1. After the failing test summary, `xcodebuild test` launches `devicectl diagnose` to collect device diagnostics.
2. On a TTY, `devicectl diagnose` enters an interactive authorization path and prints `Password:`.
3. When launched by `xcodebuild`, that subprocess is in a background TTY process group, so terminal input cannot be handled normally and the subprocess gets wedged.
4. In non-TTY mode, the same path does not block on a password prompt; it exits with the real underlying diagnostics failure (`No provider was found`, `CoreDeviceCLISupport.DiagnoseError error 0`).

This means the snapshot hang is not primarily caused by:
- `src/utils/test-common.ts`
- `src/utils/xcresult-test-failures.ts`
- `src/utils/xcodebuild-event-parser.ts`
- `src/utils/renderers/cli-text-renderer.ts`
- `src/utils/command.ts`
- `src/snapshot-tests/mcp-harness.ts`

The earlier transient `build-and-run` install failure is real, but it is a separate flaky physical-device issue, not the cause of the `Password:` hang.

## Eliminated hypotheses
- **Deterministic CLI error-latch bug for `build-and-run`** — ruled out by the captured real install failure text and exit code `1`.
- **Deterministic parser/renderer regression dropping the test footer** — ruled out by successful isolated CLI and MCP failing-test runs.
- **Deterministic MCP transport deadlock** — ruled out by successful focused MCP harness pass→fail reproduction.
- **Deterministic signing regression in the built app artifact** — ruled out by successful codesign inspection and direct `device install` of the same app path.

## Recommendations
1. Treat the `Password:` hang as an Apple `devicectl diagnose` / Xcode physical-device diagnostics problem, not as evidence of a deterministic XcodeBuildMCP refactor regression.
2. For XcodeBuildMCP’s automated/device-test paths, prefer **non-interactive process mode** and preserve full stderr/stdout so Xcode’s explicit diagnostics failure is surfaced instead of a hung terminal prompt.
3. Add timeout diagnostics around failing physical-device test runs that explicitly note whether the process appears to be stuck in post-test diagnostics collection.
4. Keep the timeout at `120_000`; increasing it just makes this Apple diagnostics wedge slower to fail.
5. Separately from the hang, keep the earlier `build-and-run` flake in mind as a real but distinct physical-device reliability issue.

## Preventive Measures
- Keep physical-device snapshot tests minimal and isolated.
- Avoid chaining many mutating device operations in one snapshot file.
- Capture direct per-step logs/artifacts for device tests so transient `devicectl` failures are visible without rerunning the whole file.
- Be careful about interpreting longer timeouts as fixes; here they mainly make the suite slower when the device gets wedged.
