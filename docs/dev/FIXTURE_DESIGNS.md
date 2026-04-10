# Snapshot test fixture designs

Target UX for all tool output. This is the TDD reference — write fixtures first, then update rendering code until output matches.

Delete this file once all fixtures are written and tests pass.

## Output rhythm (all tools)

```
<emoji> <Operation Name>

  <Param>: <value>
  <Param>: <value>

<body — varies by tool>

Next steps:
1. <step>
```

## Design principles

1. No JSON output — all tools render structured data as human-readable text
2. Every tool gets a header — emoji + operation name + indented params
3. File paths always relative where possible (rendered by `displayPath`)
4. Grouped/structured body — not raw command dumps. Focus on useful information
5. Concise for AI agents — minimize tokens while maximizing signal
6. Success + error + failure fixtures for every tool where appropriate (error = can't run; failure = ran, bad outcome)
11. Error fixtures must test real executable errors — not just pre-call validation (file-exists checks, param validation). The fixture should exercise the underlying CLI/tool and capture how we handle its error response. Pre-call validation should be handled by yargs or input schemas, not tested as snapshot fixtures.
7. Consistent icons — status emojis owned by renderer, not tools
8. Consistent spacing — one blank line between sections, always
9. No next steps on error paths
10. Tree chars (├/└) for informational lists (paths, IDs, metadata) — not for result lists (errors, failures, test outcomes)

### Error fixture policy

Every error fixture must test a **real executable/CLI error** — not pre-call validation (file-exists checks, param validation). The fixture should exercise the underlying tool and capture how we handle its error response. Pre-call validation should be handled by yargs or input schemas, not tested as snapshot fixtures.

One fixture per distinct CLI or output shape. The representative error fixtures cover all shapes:

| CLI / Shape | Representative fixture |
|---|---|
| xcodebuild (wrong scheme) | `simulator/build--error-wrong-scheme` |
| simctl terminate (bad bundle) | `simulator/stop--error-no-app` |
| simctl boot (bad UUID) | `simulator-management/boot--error-invalid-id` |
| open (invalid app) | `macos/launch--error-invalid-app` |
| xcrun xccov (invalid bundle) | `coverage/get-coverage-report--error-invalid-bundle` |
| swift build (bad path) | `swift-package/build--error-bad-path` |
| AXe (bad simulator) | `ui-automation/tap--error-no-simulator` |
| Internal: idempotency check | `project-scaffolding/scaffold-ios--error-existing` |
| Internal: no active session | `debugging/continue--error-no-session` |
| Internal: file coverage | `coverage/get-file-coverage--error-invalid-bundle` |

## Tracking checklist

### coverage
- [x] `get-coverage-report--success.txt`
- [x] `get-coverage-report--error-invalid-bundle.txt`
- [x] `get-file-coverage--success.txt`
- [x] `get-file-coverage--error-invalid-bundle.txt`
- [ ] Code updated to match fixtures

### session-management
- [x] `session-set-defaults--success.txt`
- [x] `session-show-defaults--success.txt`
- [x] `session-clear-defaults--success.txt`
- [ ] Code updated to match fixtures

### simulator-management
- [x] `list--success.txt`
- [x] `boot--error-invalid-id.txt`
- [x] `open--success.txt`
- [x] `set-appearance--success.txt`
- [x] `set-location--success.txt`
- [x] `reset-location--success.txt`
- [ ] Code updated to match fixtures

### simulator
- [x] `build--success.txt`
- [x] `build--error-wrong-scheme.txt`
- [x] `build--failure-compilation.txt`
- [x] `build-and-run--success.txt`
- [x] `test--success.txt`
- [x] `test--failure.txt`
- [x] `get-app-path--success.txt`
- [x] `list--success.txt`
- [x] `stop--error-no-app.txt`
- [ ] Code updated to match fixtures

### project-discovery
- [x] `discover-projs--success.txt`
- [x] `list-schemes--success.txt`
- [x] `show-build-settings--success.txt`
- [ ] Code updated to match fixtures

### project-scaffolding
- [x] `scaffold-ios--success.txt`
- [x] `scaffold-ios--error-existing.txt`
- [x] `scaffold-macos--success.txt`
- [ ] Code updated to match fixtures

### device
- [x] `build--success.txt`
- [x] `build--failure-compilation.txt`
- [x] `get-app-path--success.txt`
- [x] `list--success.txt`
- [ ] Code updated to match fixtures

### macos
- [x] `build--success.txt`
- [x] `build--failure-compilation.txt`
- [x] `build-and-run--success.txt`
- [x] `test--success.txt`
- [x] `test--failure.txt`
- [x] `get-app-path--success.txt`
- [x] `launch--error-invalid-app.txt`
- [ ] Code updated to match fixtures

### swift-package
- [x] `build--success.txt`
- [x] `build--error-bad-path.txt`
- [x] `build--failure-compilation.txt`
- [x] `test--success.txt`
- [x] `test--failure.txt`
- [x] `clean--success.txt`
- [x] `list--success.txt`
- [x] `run--success.txt`
- [ ] Code updated to match fixtures

### debugging
- [x] `attach--success.txt`
- [x] `add-breakpoint--success.txt`
- [x] `remove-breakpoint--success.txt`
- [x] `continue--success.txt`
- [x] `continue--error-no-session.txt`
- [x] `detach--success.txt`
- [x] `lldb-command--success.txt`
- [x] `stack--success.txt`
- [x] `variables--success.txt`
- [ ] Code updated to match fixtures

### ui-automation
- [x] `snapshot-ui--success.txt`
- [x] `tap--error-no-simulator.txt`
- [ ] Code updated to match fixtures

### utilities
- [x] `clean--success.txt`
- [ ] Code updated to match fixtures

---

## Fixture designs by workflow

### coverage

**`get-coverage-report--success.txt`**:
```
📊 Coverage Report

  xcresult: <TMPDIR>/TestResults.xcresult
  Target Filter: CalculatorAppTests

Overall: 94.9% (354/373 lines)

Targets:
  CalculatorAppTests.xctest — 94.9% (354/373 lines)

Next steps:
1. View file-level coverage: xcodebuildmcp coverage get-file-coverage --xcresult-path "<TMPDIR>/TestResults.xcresult"
```

**`get-coverage-report--error-invalid-bundle.txt`** — real executable error (fake .xcresult dir passes file-exists check, xcrun xccov fails):
```
📊 Coverage Report

  xcresult: <TMPDIR>/invalid.xcresult

❌ Failed to get coverage report: Failed to load result bundle.

Hint: Run tests with coverage enabled (e.g., xcodebuild test -enableCodeCoverage YES).
```

**`get-file-coverage--success.txt`** — already updated, keep current content.

**`get-file-coverage--error-invalid-bundle.txt`** — real executable error (fake .xcresult dir passes file-exists check, xcrun xccov fails):
```
📊 File Coverage

  xcresult: <TMPDIR>/invalid.xcresult
  File: SomeFile.swift

❌ Failed to get file coverage: Failed to load result bundle.

Hint: Make sure the xcresult bundle contains coverage data for "SomeFile.swift".
```

---

### session-management

**`session-set-defaults--success.txt`**:
```
⚙️ Set Defaults

  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Scheme: CalculatorApp

✅ Session defaults updated.
```

**`session-show-defaults--success.txt`**:
```
⚙️ Show Defaults

  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Scheme: CalculatorApp
```

**`session-clear-defaults--success.txt`**:
```
⚙️ Clear Defaults

✅ Session defaults cleared.
```

---

### simulator-management

**`list--success.txt`**:
```
📱 List Simulators

iOS 26.2:
  iPhone 17 Pro       <UUID>  Booted
  iPhone 17 Pro Max   <UUID>
  iPhone Air          <UUID>
  iPhone 17           <UUID>  Booted
  iPhone 16e          <UUID>
  iPad Pro 13-inch (M5)   <UUID>
  iPad Pro 11-inch (M5)   <UUID>
  iPad mini (A17 Pro)     <UUID>
  iPad (A16)              <UUID>
  iPad Air 13-inch (M3)   <UUID>
  iPad Air 11-inch (M3)   <UUID>

watchOS 26.2:
  Apple Watch Series 11 (46mm)   <UUID>
  Apple Watch Series 11 (42mm)   <UUID>
  Apple Watch Ultra 3 (49mm)     <UUID>
  Apple Watch SE 3 (44mm)        <UUID>
  Apple Watch SE 3 (40mm)        <UUID>

tvOS 26.2:
  Apple TV 4K (3rd generation)             <UUID>
  Apple TV 4K (3rd generation) (at 1080p)  <UUID>
  Apple TV                                 <UUID>

xrOS 26.2:
  Apple Vision Pro   <UUID>

Next steps:
1. Boot simulator: xcodebuildmcp simulator-management boot --simulator-id "UUID_FROM_ABOVE"
2. Open Simulator UI: xcodebuildmcp simulator-management open
3. Build for simulator: xcodebuildmcp simulator build --scheme "YOUR_SCHEME" --simulator-id "UUID_FROM_ABOVE"
4. Get app path: xcodebuildmcp simulator get-app-path --scheme "YOUR_SCHEME" --platform "iOS Simulator" --simulator-id "UUID_FROM_ABOVE"
```

Runtime names shortened from `com.apple.CoreSimulator.SimRuntime.iOS-26-2` to `iOS 26.2`. Tabular layout. Booted state shown inline.

**`boot--error-invalid-id.txt`**:
```
🔌 Boot Simulator

  Simulator: <UUID>

❌ Failed to boot simulator: Invalid device or device pair: <UUID>

Next steps:
1. Open Simulator UI: xcodebuildmcp simulator-management open
2. Install app: xcodebuildmcp simulator install --simulator-id "SIMULATOR_UUID" --app-path "PATH_TO_YOUR_APP"
3. Launch app: xcodebuildmcp simulator launch-app --simulator-id "SIMULATOR_UUID" --bundle-id "YOUR_APP_BUNDLE_ID"
```

**`open--success.txt`**:
```
📱 Open Simulator

✅ Simulator app opened successfully.

Next steps:
1. Boot simulator: xcodebuildmcp simulator-management boot --simulator-id "UUID_FROM_LIST_SIMS"
2. Start log capture: xcodebuildmcp logging start-simulator-log-capture --simulator-id "UUID" --bundle-id "YOUR_APP_BUNDLE_ID"
3. Launch app with logs: xcodebuildmcp simulator launch-app-with-logs --simulator-id "UUID" --bundle-id "YOUR_APP_BUNDLE_ID"
```

**`set-appearance--success.txt`**:
```
🎨 Set Appearance

  Simulator: <UUID>
  Mode: dark

✅ Appearance set to dark mode.
```

**`set-location--success.txt`**:
```
📍 Set Location

  Simulator: <UUID>
  Latitude: 37.7749
  Longitude: -122.4194

✅ Location set to 37.7749, -122.4194.
```

**`reset-location--success.txt`**:
```
📍 Reset Location

  Simulator: <UUID>

✅ Location reset to default.
```

---

### simulator

**`build--success.txt`** — pipeline-rendered, review for unified UX consistency.

**`build--error-wrong-scheme.txt`** — pipeline-rendered, representative pipeline error fixture.

**`build--failure-compilation.txt`** — build ran but failed with compiler errors (uses CompileError.fixture.swift injected into app target):
```
🔨 Build

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator
  Simulator: iPhone 17

Errors (1):
  ✗ CalculatorApp/CompileError.swift:3: Cannot convert value of type 'String' to specified type 'Int'

❌ Build failed. (⏱️ <DURATION>)
```

**`build-and-run--success.txt`** — pipeline-rendered, review for consistency.

**`test--success.txt`** — all tests pass:
```
🧪 Test

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator
  Simulator: iPhone 17

Resolved to <N> test(s)

✅ Test succeeded. (<TEST_COUNTS>, ⏱️ <DURATION>)

Next steps:
1. View test coverage: xcodebuildmcp coverage get-coverage-report --xcresult-path "XCRESULT_PATH"
```

**`test--failure.txt`** — tests ran, assertion failures:
```
🧪 Test

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator
  Simulator: iPhone 17

Resolved to <N> test(s)

Failures (1):
  ✗ CalculatorAppTests.testCalculatorServiceFailure — XCTAssertEqual failed: ("0") is not equal to ("999")

❌ Test failed. (<TEST_COUNTS>, ⏱️ <DURATION>)
```

**`get-app-path--success.txt`**:
```
🔍 Get App Path

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator

  └ App Path: <HOME>/Library/Developer/Xcode/DerivedData/CalculatorApp-<HASH>/Build/Products/Debug-iphonesimulator/CalculatorApp.app

Next steps:
1. Get bundle ID: xcodebuildmcp project-discovery get-app-bundle-id --app-path "<HOME>/Library/Developer/Xcode/DerivedData/CalculatorApp-<HASH>/Build/Products/Debug-iphonesimulator/CalculatorApp.app"
2. Boot simulator: xcodebuildmcp simulator-management boot --simulator-id "<UUID>"
3. Install on simulator: xcodebuildmcp simulator install --simulator-id "<UUID>" --app-path "<HOME>/Library/Developer/Xcode/DerivedData/CalculatorApp-<HASH>/Build/Products/Debug-iphonesimulator/CalculatorApp.app"
4. Launch on simulator: xcodebuildmcp simulator launch-app --simulator-id "<UUID>" --bundle-id "BUNDLE_ID"
```

**`list--success.txt`** — same as simulator-management/list--success.txt (shared tool).

**`stop--error-no-app.txt`**:
```
🛑 Stop App

  Simulator: <UUID>
  Bundle ID: com.nonexistent.app

❌ Failed to stop app: An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=164): found nothing to terminate
```

---

### project-discovery

**`discover-projs--success.txt`**:
```
🔍 Discover Projects

  Search Path: .

Workspaces:
  example_projects/iOS_Calculator/CalculatorApp.xcworkspace

Projects:
  example_projects/iOS_Calculator/CalculatorApp.xcodeproj

Next steps:
1. Build and run: xcodebuildmcp simulator build-and-run
```

**`list-schemes--success.txt`**:
```
🔍 List Schemes

  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace

Schemes:
  CalculatorApp
  CalculatorAppFeature

Next steps:
1. Build for macOS: xcodebuildmcp macos build --workspace-path "example_projects/iOS_Calculator/CalculatorApp.xcworkspace" --scheme "CalculatorApp"
2. Build and run on simulator: xcodebuildmcp simulator build-and-run --workspace-path "example_projects/iOS_Calculator/CalculatorApp.xcworkspace" --scheme "CalculatorApp" --simulator-name "iPhone 17"
3. Build for simulator: xcodebuildmcp simulator build --workspace-path "example_projects/iOS_Calculator/CalculatorApp.xcworkspace" --scheme "CalculatorApp" --simulator-name "iPhone 17"
4. Show build settings: xcodebuildmcp device show-build-settings --workspace-path "example_projects/iOS_Calculator/CalculatorApp.xcworkspace" --scheme "CalculatorApp"
```

**`show-build-settings--success.txt`** — curated summary (full dump behind `--verbose` flag):
```
🔍 Show Build Settings

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace

Key Settings:
  ├ PRODUCT_NAME: CalculatorApp
  ├ PRODUCT_BUNDLE_IDENTIFIER: io.sentry.calculatorapp
  ├ SDKROOT: iphoneos
  ├ SUPPORTED_PLATFORMS: iphonesimulator iphoneos
  ├ ARCHS: arm64
  ├ SWIFT_VERSION: 6.0
  ├ IPHONEOS_DEPLOYMENT_TARGET: 18.0
  ├ CODE_SIGNING_ALLOWED: YES
  ├ CODE_SIGN_IDENTITY: Apple Development
  ├ CONFIGURATION: Debug
  ├ BUILD_DIR: <HOME>/Library/Developer/Xcode/DerivedData/CalculatorApp-<HASH>/Build/Products
  └ BUILT_PRODUCTS_DIR: <HOME>/Library/Developer/Xcode/DerivedData/CalculatorApp-<HASH>/Build/Products/Debug-iphoneos

Next steps:
1. Build for simulator: xcodebuildmcp simulator build --workspace-path "example_projects/iOS_Calculator/CalculatorApp.xcworkspace" --scheme "CalculatorApp"
```

---

### project-scaffolding

**`scaffold-ios--success.txt`**:
```
🏗️ Scaffold iOS Project

  Name: SnapshotTestApp
  Path: <TMPDIR>/ios
  Platform: iOS

✅ Project scaffolded successfully.

Next steps:
1. Read the README.md in the workspace root directory before working on the project.
2. Build for simulator: xcodebuildmcp simulator build --workspace-path "<TMPDIR>/ios/SnapshotTestApp.xcworkspace" --scheme "SnapshotTestApp" --simulator-name "iPhone 17"
3. Build and run on simulator: xcodebuildmcp simulator build-and-run --workspace-path "<TMPDIR>/ios/SnapshotTestApp.xcworkspace" --scheme "SnapshotTestApp" --simulator-name "iPhone 17"
```

**`scaffold-ios--error-existing.txt`**:
```
🏗️ Scaffold iOS Project

  Path: <TMPDIR>/ios-existing

❌ Xcode project files already exist in <TMPDIR>/ios-existing.
```

**`scaffold-macos--success.txt`**:
```
🏗️ Scaffold macOS Project

  Name: SnapshotTestApp
  Path: <TMPDIR>/macos
  Platform: macOS

✅ Project scaffolded successfully.

Next steps:
1. Build for macOS: xcodebuildmcp macos build --project-path "<TMPDIR>/macos/SnapshotTestApp.xcodeproj" --scheme "SnapshotTestApp"
2. Build and run on macOS: xcodebuildmcp macos build-and-run --project-path "<TMPDIR>/macos/SnapshotTestApp.xcodeproj" --scheme "SnapshotTestApp"
```

---

### device

**`build--success.txt`** — pipeline-rendered, review for unified UX consistency.

**`build--failure-compilation.txt`** — build ran but failed with compiler errors:
```
🔨 Build

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS

Errors (1):
  ✗ CalculatorApp/CompileError.swift:3: Cannot convert value of type 'String' to specified type 'Int'

❌ Build failed. (⏱️ <DURATION>)
```

**`get-app-path--success.txt`**:
```
🔍 Get App Path

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS

  └ App Path: <HOME>/Library/Developer/Xcode/DerivedData/CalculatorApp-<HASH>/Build/Products/Debug-iphoneos/CalculatorApp.app

Next steps:
1. Get bundle ID: xcodebuildmcp project-discovery get-app-bundle-id --app-path "..."
2. Install on device: xcodebuildmcp device install --app-path "..."
3. Launch on device: xcodebuildmcp device launch --bundle-id "BUNDLE_ID"
```

**`list--success.txt`**:
```
📱 List Devices

✅ Available Devices:

  Cameron's Apple Watch
    ├ UDID: <UUID>
    ├ Model: Watch4,2
    ├ Platform: Unknown 10.6.1
    ├ CPU: arm64_32
    └ Developer Mode: disabled

  Cameron's Apple Watch
    ├ UDID: <UUID>
    ├ Model: Watch7,20
    ├ Platform: Unknown 26.1
    ├ CPU: arm64e
    ├ Connection: localNetwork
    └ Developer Mode: disabled

  Cameron's iPhone 16 Pro Max
    ├ UDID: <UUID>
    ├ Model: iPhone17,2
    ├ Platform: Unknown 26.3.1
    ├ CPU: arm64e
    ├ Connection: localNetwork
    └ Developer Mode: enabled

  iPhone
    ├ UDID: <UUID>
    ├ Model: iPhone99,11
    ├ Platform: Unknown 26.1
    └ CPU: arm64e

Next steps:
1. Build for device: xcodebuildmcp device build --scheme "SCHEME" --device-id "DEVICE_UDID"
2. Run tests on device: xcodebuildmcp device test --scheme "SCHEME" --device-id "DEVICE_UDID"
3. Get app path: xcodebuildmcp device get-app-path --scheme "SCHEME"
```

---

### macos

**`build--success.txt`** — pipeline-rendered, review for unified UX consistency.

**`build--failure-compilation.txt`** — build ran but failed with compiler errors:
```
🔨 Build

  Scheme: MCPTest
  Project: example_projects/macOS/MCPTest.xcodeproj
  Configuration: Debug
  Platform: macOS

Errors (1):
  ✗ MCPTest/CompileError.swift:3: Cannot convert value of type 'String' to specified type 'Int'

❌ Build failed. (⏱️ <DURATION>)
```

**`build-and-run--success.txt`** — pipeline-rendered, review for consistency.

**`test--success.txt`** — all tests pass (MCPTest has only passing tests).

**`test--failure.txt`** — tests ran, assertion failures (requires intentional failure in MCPTest):
```
🧪 Test

  Scheme: MCPTest
  Project: example_projects/macOS/MCPTest.xcodeproj
  Configuration: Debug
  Platform: macOS

Resolved to <N> test(s)

Failures (1):
  ✗ MCPTestTests.testIntentionalFailure — Expectation failed

❌ Test failed. (<TEST_COUNTS>, ⏱️ <DURATION>)
```

**`get-app-path--success.txt`** — same pattern as simulator/device get-app-path.

**`launch--error-invalid-app.txt`** — real `open` CLI error (fake .app dir passes file-exists, open fails):
```
🚀 Launch macOS App

  App: <TMPDIR>/Fake.app

❌ Launch failed: The application cannot be opened because its executable is missing.
```

---

### swift-package

**`build--success.txt`**:
```
📦 Swift Package Build

  Package: example_projects/SwiftPackage

✅ Build succeeded. (<DURATION>)
```

**`build--error-bad-path.txt`** — real swift CLI error (swift build runs and fails on missing path):
```
📦 Swift Package Build

  Package: example_projects/NONEXISTENT

❌ Build failed: No such file or directory: example_projects/NONEXISTENT
```

**`build--failure-compilation.txt`** — build ran but failed with compiler errors:
```
📦 Swift Package Build

  Package: example_projects/SwiftPackage

Errors (1):
  ✗ Sources/CompileError.swift:3: Cannot convert value of type 'String' to specified type 'Int'

❌ Build failed. (<DURATION>)
```

**`test--success.txt`**:
```
🧪 Swift Package Test

  Package: example_projects/SwiftPackage

✅ All tests passed. (5 tests, <DURATION>)

Tests:
  ✔ Array operations
  ✔ Basic math operations
  ✔ Basic truth assertions
  ✔ Optional handling
  ✔ String operations
```

**`test--failure.txt`** — tests ran, assertion failures (requires intentional failure in SPM example):
```
🧪 Swift Package Test

  Package: example_projects/SwiftPackage

Failures (1):
  ✗ IntentionalFailureTests.testShouldFail — #expect failed

❌ Tests failed. (1 failure, <DURATION>)
```

**`clean--success.txt`**:
```
🧹 Swift Package Clean

  Package: example_projects/SwiftPackage

✅ Clean succeeded. Build artifacts removed.
```

**`list--success.txt`**:
```
📦 Swift Package List

ℹ️ No Swift Package processes currently running.
```

**`run--success.txt`**:
```
📦 Swift Package Run

  Package: example_projects/SwiftPackage

✅ Executable completed successfully.

Output:
  Hello, world!
```

---

### debugging

**`attach--success.txt`** — debugger attached to running simulator process:
```
🐛 Attach Debugger

  Simulator: <UUID>

✅ Attached LLDB to simulator process <PID> (<UUID>).

  ├ Debug Session: <UUID>
  └ Status: Execution resumed after attach.

Next steps:
1. Add breakpoint: xcodebuildmcp debugging add-breakpoint --file "..." --line 42
2. View stack trace: xcodebuildmcp debugging stack
3. View variables: xcodebuildmcp debugging variables
```

**`add-breakpoint--success.txt`** — breakpoint set at file:line:
```
🐛 Add Breakpoint

  File: ContentView.swift
  Line: 42

✅ Breakpoint 1 set.

Next steps:
1. Continue execution: xcodebuildmcp debugging continue
2. View stack trace: xcodebuildmcp debugging stack
3. View variables: xcodebuildmcp debugging variables
```

**`remove-breakpoint--success.txt`**:
```
🐛 Remove Breakpoint

  Breakpoint: 1

✅ Breakpoint 1 removed.
```

**`continue--success.txt`**:
```
🐛 Continue

✅ Resumed debugger session.

Next steps:
1. View stack trace: xcodebuildmcp debugging stack
2. View variables: xcodebuildmcp debugging variables
```

**`continue--error-no-session.txt`**:
```
🐛 Continue

❌ No active debug session. Provide debugSessionId or attach first.
```

**`detach--success.txt`**:
```
🐛 Detach

✅ Detached debugger session.
```

**`lldb-command--success.txt`** — raw LLDB output passed through:
```
🐛 LLDB Command

  Command: po self

<CalculatorService: display="0", expressionDisplay="">
```

**`stack--success.txt`** — stack trace from paused process:
```
🐛 Stack Trace

* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 1.1
  * frame #0: CalculatorApp`ContentView.body.getter at ContentView.swift:42
    frame #1: SwiftUI`ViewGraph.updateOutputs()
    frame #2: SwiftUI`ViewRendererHost.render()
```

**`variables--success.txt`** — variable dump from current frame:
```
🐛 Variables

(CalculatorService) self = {
  ├ display = "0"
  ├ expressionDisplay = ""
  ├ currentValue = 0
  ├ previousValue = 0
  └ currentOperation = nil
}
```

---

### ui-automation

**`snapshot-ui--success.txt`** — accessibility tree with header prepended:
```
🔍 Snapshot UI

  Simulator: <UUID>

<existing accessibility tree content preserved — this IS the useful data for agents>
```

**`tap--error-no-simulator.txt`**:
```
👆 Tap

  Simulator: <UUID>
  Position: (100, 100)

❌ Failed to simulate tap: Simulator with UDID <UUID> not found.
```

---

### utilities

**`clean--success.txt`** — pipeline-rendered, review for unified UX consistency.
