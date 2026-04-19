# Investigation: Simulator test hang and EMFILE failures

## Summary
XcodeBuildMCP definitively leaks detached simulator OSLog stream processes from the simulator launch-with-logging path. Real-world verification showed that production code created orphaned `simctl spawn <sim> log stream ...` processes under PID 1, the normal `simulator stop` command did not clean them up, and repeated launches accumulated additional survivors. After clearing the leaked processes, the previously unhealthy simulator recovered: `xcrun simctl get_app_container ...` completed successfully in `259 ms`, and a real `node build/cli.js simulator test ...` run progressed through `test-without-building`, executed tests, and returned control to the terminal instead of hanging at `Process spawn via launchd failed`. That makes the leak the confirmed cause of the broken simulator state behind the original symptom.

## Symptoms
- `build-for-testing` succeeds.
- `test-without-building` reports `Process spawn via launchd failed` and `Too many open files`.
- `NSPOSIXErrorDomain Code 24` appears in Xcode output.
- The failing `xcodebuild` process can remain alive after printing the error.
- On the machine, dozens of orphaned `simctl spawn ... log stream ...` processes existed for the same simulator and bundle.

## Investigation Log

### Phase 1 - Initial machine assessment
**Hypothesis:** The simulator/Xcode environment had accumulated leaked processes or descriptors from earlier E2E/manual work.
**Findings:** The shell limit was high, but launchd soft maxfiles was low, and the machine had many orphaned simulator log-stream processes plus multiple stuck `xcodebuild` instances.
**Evidence:**
- `ulimit -n` returned `1048575`.
- `launchctl limit maxfiles` returned soft `256`, hard `unlimited`.
- `ps` showed **81** live `simctl spawn 01DA97D9-3856-46C5-A75E-DDD48100B2DB log stream --level=debug --predicate subsystem == "io.sentry.calculatorapp"` processes under PID 1.
- `ps -p 46498,48422 -o pid,ppid,stat,etime,command` showed two stuck `xcodebuild ... test-without-building` processes still alive.
- `lsof -p 46498 | wc -l` and `lsof -p 48422 | wc -l` each showed about 200 open fds.
**Conclusion:** Confirmed degraded local environment. Needed to separate product leak from broader simulator/Xcode damage.

### Phase 2 - Code path identification
**Hypothesis:** Recent simulator launch work in XcodeBuildMCP explicitly creates detached OSLog stream processes and fails to manage their lifecycle.
**Findings:** `launchSimulatorAppWithLogging()` starts an OSLog stream via `startOsLogStream()`. That helper spawns detached `xcrun simctl spawn ... log stream` children and immediately `unref()`s them. `stop_app_sim` only terminates the app and does not stop the OSLog stream. Session tracking only accounts for `activeLogSessions` from `log_capture.ts`, not these detached children.
**Evidence:**
- `src/utils/simulator-steps.ts:205` calls `startOsLogStream(...)`.
- `src/utils/simulator-steps.ts:251` defines `startOsLogStream`.
- `src/utils/simulator-steps.ts:278` sets `detached: true`.
- `src/utils/simulator-steps.ts:281` calls `child.unref()`.
- `src/mcp/tools/simulator/stop_app_sim.ts:58` only runs `['xcrun', 'simctl', 'terminate', simulatorId, params.bundleId]`.
- `src/utils/log_capture.ts:60` stores tracked sessions in `activeLogSessions`.
- `src/utils/log-capture/index.ts:10-11` lists only `activeLogSessions` ids.
- `src/utils/session-status.ts:52` reports simulator active session ids from `listActiveSimulatorLogSessionIds()`.
**Conclusion:** Confirmed product design bug: detached OSLog children are created outside the tracked log-session lifecycle.

### Phase 3 - Real-world proof that production code creates orphaned OSLog children
**Hypothesis:** The production simulator launch helper is capable of creating the exact orphaned `simctl spawn ... log stream ...` processes observed on the machine.
**Findings:** After clearing all existing matching orphan processes, running the production `launchSimulatorAppWithLogging()` helper created a new detached `simctl spawn ... log stream ...` process under PID 1 for the exact simulator and bundle under investigation.
**Evidence:**
- Before the controlled run, matching process count was `0`.
- Production helper invocation used built code:
  ```sh
  node --input-type=module - <<'NODE'
  import { launchSimulatorAppWithLogging } from './build/utils/simulator-steps.js';
  const fakeExecutor = async () => ({ success: true, output: 'io.sentry.calculatorapp: 123', process: { pid: 123 }, exitCode: 0 });
  const result = await launchSimulatorAppWithLogging(
    '01DA97D9-3856-46C5-A75E-DDD48100B2DB',
    'io.sentry.calculatorapp',
    fakeExecutor,
  );
  console.log(JSON.stringify(result, null, 2));
  NODE
  ```
- That helper returned success and produced an OSLog file:
  `/Users/cameroncooke/Library/Developer/XcodeBuildMCP/logs/io.sentry.calculatorapp_oslog_2026-04-11T08-46-40-929Z_pid62912.log`
- Immediately afterward, process table showed:
  `62966     1 00:11 /Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl spawn 01DA97D9-3856-46C5-A75E-DDD48100B2DB log stream --level=debug --predicate subsystem == "io.sentry.calculatorapp"`
- The OSLog file contained runtime output from the launched app, including:
  `Calculator app launched`
**Conclusion:** Definitively confirmed. The observed orphan command line is created by XcodeBuildMCP production code.

### Phase 4 - Real-world proof that normal stop does not clean up the leaked child
**Hypothesis:** The normal stop tool leaves the detached OSLog stream running.
**Findings:** Running the normal stop command successfully terminated the app, but the detached log-stream process remained alive under PID 1.
**Evidence:**
- Stop command used:
  ```sh
  node build/cli.js simulator stop --simulator-id 01DA97D9-3856-46C5-A75E-DDD48100B2DB --bundle-id io.sentry.calculatorapp --output text
  ```
- CLI output reported `App stopped successfully`.
- After stop, process table still showed:
  `62966     1 00:20 /Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl spawn 01DA97D9-3856-46C5-A75E-DDD48100B2DB log stream --level=debug --predicate subsystem == "io.sentry.calculatorapp"`
- Matching process count remained `1`.
**Conclusion:** Definitively confirmed. `simulator stop` does not stop the detached OSLog stream child created by launch-with-logging.

### Phase 5 - Real-world proof of accumulation
**Hypothesis:** Repeated launches can accumulate additional detached OSLog stream survivors.
**Findings:** A second invocation of the same production helper created another survivor. Two distinct PIDs were alive concurrently under PID 1.
**Evidence:**
- Second production helper invocation returned success and wrote a second OSLog file:
  `/Users/cameroncooke/Library/Developer/XcodeBuildMCP/logs/io.sentry.calculatorapp_oslog_2026-04-11T08-47-12-997Z_pid63093.log`
- Process table then showed both:
  - `62966     1 00:49 /Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl spawn ...`
  - `63142     1 00:17 /Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl spawn ...`
- Matching process count was `2`.
- The first OSLog file later contained output from both launches, while the second file also contained output from the second launch, showing overlapping capture behavior.
**Conclusion:** Definitively confirmed. The leak accumulates across repeated launches.

### Phase 6 - Short-timeout false positive and post-cleanup recovery
**Hypothesis:** The earlier `get_app_container` timeout may have been a measurement artifact, and the real question is whether the simulator recovers once the leaked processes are removed.
**Findings:** The earlier 5-second probe was too aggressive and not a reliable signal. After cleanup, rerunning the simulator metadata command with a realistic timeout completed successfully in `259 ms`. A real `simulator test` run then progressed through `build-for-testing`, entered `test-without-building`, executed tests, and returned control to the terminal. The failure mode changed from `Process spawn via launchd failed / Code 24 / blinking cursor` to ordinary test execution with the fixture project's expected intentional failures.
**Evidence:**
- Cleanup removed all matching orphan streams: count changed from `81` to `0`.
- Post-cleanup verification command:
  ```sh
  python3 - <<'PY'
  import subprocess, time
  cmd = ['xcrun','simctl','get_app_container','01DA97D9-3856-46C5-A75E-DDD48100B2DB','io.sentry.calculatorapp','app']
  start = time.time()
  out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
  print('STATUS:completed')
  print('RC:', out.returncode)
  print('ELAPSED_MS:', int((time.time()-start)*1000))
  print('STDOUT:', out.stdout.strip())
  PY
  ```
  returned `STATUS:completed`, `RC: 0`, and `ELAPSED_MS: 259` with a valid app-container path.
- Real test command:
  ```sh
  node build/cli.js simulator test --workspace-path /Volumes/Developer/XcodeBuildMCP/example_projects/iOS_Calculator/CalculatorApp.xcworkspace --scheme CalculatorApp --simulator-id 01DA97D9-3856-46C5-A75E-DDD48100B2DB --output raw
  ```
  completed and returned exit code `1` only because the fixture suite contains intentional failures. Final output included:
  - `IDETestOperationsObserverDebug: 16.342 elapsed -- Testing started completed.`
  - `** TEST EXECUTE FAILED **`
  - result bundle path under `/Users/cameroncooke/Library/Developer/XcodeBuildMCP/DerivedData/Logs/Test/...`
- Critically, the rerun did **not** reproduce `Process spawn via launchd failed`, `NSPOSIXErrorDomain Code 24`, or the terminal hang.
**Conclusion:** Confirmed. Clearing the leaked OSLog stream processes restored simulator health sufficiently for the original test path to run normally. The leak is the verified cause of the broken simulator state behind the original symptom.

### Phase 7 - Eliminated hypotheses
**Hypothesis:** `test_sim` directly creates the leaked `simctl spawn ... log stream ...` children.
**Findings:** `test_sim` does not call `launchSimulatorAppWithLogging()` or `startOsLogStream()`.
**Evidence:**
- `src/mcp/tools/simulator/test_sim.ts` routes into `src/utils/test-common.ts` and xcodebuild orchestration, not simulator launch-with-logging.
- The actual spawn site is `src/utils/simulator-steps.ts:251-281`.
**Conclusion:** Eliminated. `test_sim` is not the direct source of the observed orphan stream processes.

## Root Cause
There is a definitive product-side leak in XcodeBuildMCP’s simulator launch-with-logging path.

`launchSimulatorAppWithLogging()` in `src/utils/simulator-steps.ts` starts OSLog capture by calling `startOsLogStream()` (`src/utils/simulator-steps.ts:205`). `startOsLogStream()` then launches:

```ts
xcrun simctl spawn <simulatorUuid> log stream --level=debug --predicate subsystem == "<bundleId>"
```

using `detached: true` (`src/utils/simulator-steps.ts:278`) and immediately `child.unref()` (`src/utils/simulator-steps.ts:281`). The process handle is not stored in any registry, and the normal stop path only runs `simctl terminate` on the app (`src/mcp/tools/simulator/stop_app_sim.ts:58`). Therefore these OSLog stream children are not tied to app lifecycle, not visible in tracked simulator log-session state, and not cleaned up by the normal stop tool.

This was verified with real production code and real process-table inspection:
- the helper created the exact orphaned `simctl spawn ... log stream ...` process shape seen in the field,
- the process lived under PID 1 after the parent exited,
- `simulator stop` did not remove it,
- and repeated launches accumulated multiple survivors.

This was verified end-to-end with real recovery evidence: after removing the leaked stream processes, simulator metadata calls succeeded again and the original `simulator test` command stopped failing in the launch path. In other words, `Code 24` was Xcode/CoreSimulator reporting the downstream effect — an unhealthy simulator launch environment caused by the leaked detached helpers — rather than a separate root cause inside the test suite itself.

## Recommendations
1. Track OSLog stream children from `src/utils/simulator-steps.ts` in an explicit registry.
   - File: `src/utils/simulator-steps.ts`
   - Record PID/process handle, simulator id, bundle id, and log path.
2. Stop tracked OSLog stream children when the app is stopped.
   - File: `src/mcp/tools/simulator/stop_app_sim.ts`
   - Extend stop flow to terminate the matching OSLog stream(s), not just the app.
3. Integrate detached simulator OSLog stream cleanup into shutdown/session lifecycle.
   - Files: `src/server/mcp-shutdown.ts`, `src/server/mcp-lifecycle.ts`, `src/utils/session-status.ts`
   - Ensure status reflects these children and shutdown cleans them.
4. Add regression tests for lifecycle, not just launch success.
   - Files: `src/mcp/tools/simulator/__tests__/launch_app_sim.test.ts`, `src/mcp/tools/simulator/__tests__/stop_app_sim.test.ts`, `src/utils/__tests__/simulator-steps-pid.test.ts`
   - Assert launch creates tracked OSLog capture and stop/shutdown removes it.
5. Add a doctor/cleanup path for existing leaked simulator OSLog streams.
   - Detect orphaned `simctl spawn <sim> log stream ...` helpers and terminate them before they poison later runs.

## Preventive Measures
- Never start detached helper processes without a matching ownership and teardown model.
- Surface all long-lived simulator-side helpers in session status.
- Add an integration test that repeatedly launches/stops an app and asserts no monotonic growth in matching `simctl`/`xcodebuild` processes.
- Add a cleanup command or doctor check that detects and reports orphaned simulator OSLog streams.
