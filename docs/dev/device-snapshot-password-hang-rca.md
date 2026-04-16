# RCA: Physical-device snapshot test hang after failing test

## Summary
When a physical-device `xcodebuild test` run fails, Xcode launches `devicectl diagnose` to collect post-failure diagnostics. On an interactive terminal, `devicectl diagnose` prompts for a local macOS password before starting diagnostics collection. When Xcode launches that same interactive flow from the test process, it can wedge and make device snapshot tests appear to hang.

## Symptoms
- A physical-device snapshot test stalls after the final XCTest summary.
- In a terminal/PTTY run, a transient or persistent `Password:` line appears after the failing test summary.
- MCP/snapshot runs may sit until timeout instead of surfacing the real diagnostics failure.

## Confirmed evidence
- The hang happens after test execution, not during the app test run itself.
- After a failing physical-device test, `xcodebuild` launches:
  ```bash
  /Library/Developer/PrivateFrameworks/CoreDevice.framework/Versions/A/Resources/bin/devicectl diagnose ...
  ```
- Running `devicectl diagnose` directly on a terminal reproduces the password gate:
  - prints Apple privacy text
  - prompts with `Password:`
  - after local auth, proceeds with diagnostics collection and completes
- Running the same `xcodebuild test` command without a TTY does not hang; instead it exits and prints the underlying diagnostics error:
  - `Failure collecting diagnostics from devices`
  - `No provider was found`
  - `CoreDeviceCLISupport.DiagnoseError error 0`

## Root cause
This is an Apple tooling issue in the post-failure device diagnostics path:

1. A failing physical-device test triggers `devicectl diagnose`.
2. `devicectl diagnose` can require interactive local macOS authentication.
3. In the `xcodebuild`-launched context, that interactive auth path may not be able to complete cleanly, so the run wedges.

## Scope
This explains hangs after failing physical-device tests. It does not explain unrelated build/install flake in other device flows.

## Practical guidance
- If a physical-device snapshot test hangs after the final test summary, check for a `Password:` prompt.
- Prefer non-interactive execution when automating this flow so the command fails fast instead of hanging.
- Do not treat longer timeouts as a fix; they only make this Apple diagnostics wedge slower to fail.

## Useful manual repro
```bash
/Library/Developer/PrivateFrameworks/CoreDevice.framework/Versions/A/Resources/bin/devicectl diagnose \
  --devices <PHYSICAL_DEVICE_UDID> \
  --no-finder \
  --archive-destination /tmp/devicectl-live-sample.zip \
  --timeout 600
```

If prompted and local auth succeeds, the command proceeds with diagnostics collection and writes a zip archive.
