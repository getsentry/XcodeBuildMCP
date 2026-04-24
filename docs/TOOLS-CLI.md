# XcodeBuildMCP CLI Tools Reference

This document lists CLI tool names as exposed by `xcodebuildmcp <workflow> <tool>`.

XcodeBuildMCP provides 71 canonical tools organized into 13 workflow groups.

## Workflow Groups

### Build Utilities (`utilities`)
**Purpose**: Utility tools for cleaning build products and managing build artifacts. (1 tools)

- `clean` - Defined in iOS Device Development workflow.



### Code Coverage (`coverage`)
**Purpose**: View code coverage data from xcresult bundles produced by test runs. (2 tools)

- `get-coverage-report` - Show per-target code coverage from an xcresult bundle.
- `get-file-coverage` - Show function-level coverage and uncovered line ranges for a specific file.



### iOS Device Development (`device`)
**Purpose**: Complete iOS development workflow for physical devices (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro). (15 tools)

- `build` - Build for device.
- `build-and-run` - Build, install, and launch on physical device. Runtime logs are captured automatically and the log file path is included in the response. Preferred single-step run tool when defaults are set.
- `clean` - Clean build products.
- `discover-projects` - Scans a directory (defaults to workspace root) to find Xcode project (.xcodeproj) and workspace (.xcworkspace) files. Use when project/workspace path is unknown.
- `get-app-bundle-id` - Extract bundle id from .app.
- `get-app-path` - Get device built app path.
- `get-coverage-report` - Defined in Code Coverage workflow.
- `get-file-coverage` - Defined in Code Coverage workflow.
- `install` - Install app on device.
- `launch` - Launch app on device.
- `list` - List connected devices.
- `list-schemes` - List Xcode schemes.
- `show-build-settings` - Show build settings.
- `stop` - Stop device app.
- `test` - Test on device.



### iOS Simulator Development (`simulator`)
**Purpose**: Complete iOS development workflow for both .xcodeproj and .xcworkspace files targeting simulators. (20 tools)

- `boot` - Defined in Simulator Management workflow.
- `build` - Build for iOS sim (compile-only, no launch).
- `build-and-run` - Build, install, and launch on iOS Simulator; boots simulator and attempts to open Simulator.app as needed. Runtime logs are captured automatically and the log file path is included in the response. Preferred single-step run tool when defaults are set.
- `clean` - Defined in iOS Device Development workflow.
- `discover-projects` - Defined in iOS Device Development workflow.
- `get-app-bundle-id` - Defined in iOS Device Development workflow.
- `get-app-path` - Get sim built app path.
- `get-coverage-report` - Defined in Code Coverage workflow.
- `get-file-coverage` - Defined in Code Coverage workflow.
- `install` - Install app on sim.
- `launch-app` - Launch app on simulator. Runtime logs are captured automatically and the log file path is included in the response.
- `list` - Defined in Simulator Management workflow.
- `list-schemes` - Defined in iOS Device Development workflow.
- `open` - Defined in Simulator Management workflow.
- `record-video` - Record sim video.
- `screenshot` - Capture screenshot.
- `show-build-settings` - Defined in iOS Device Development workflow.
- `snapshot-ui` - Print view hierarchy with precise view coordinates (x, y, width, height) for visible elements.
- `stop` - Stop sim app.
- `test` - Test on iOS sim.



### LLDB Debugging (`debugging`)
**Purpose**: Attach LLDB debugger to simulator apps, set breakpoints, inspect variables and call stacks. (8 tools)

- `add-breakpoint` - Add breakpoint.
- `attach` - Attach LLDB to sim app.
- `continue` - Continue debug session.
- `detach` - Detach debugger.
- `lldb-command` - Run LLDB command.
- `remove-breakpoint` - Remove breakpoint.
- `stack` - Get backtrace.
- `variables` - Get frame variables.



### macOS Development (`macos`)
**Purpose**: Complete macOS development workflow for both .xcodeproj and .xcworkspace files. Build, test, deploy, and manage macOS applications. (13 tools)

- `build` - Build macOS app.
- `build-and-run` - Build and run macOS app.
- `clean` - Defined in iOS Device Development workflow.
- `discover-projects` - Defined in iOS Device Development workflow.
- `get-app-path` - Get macOS built app path.
- `get-coverage-report` - Defined in Code Coverage workflow.
- `get-file-coverage` - Defined in Code Coverage workflow.
- `get-macos-bundle-id` - Extract bundle id from macOS .app.
- `launch` - Launch macOS app.
- `list-schemes` - Defined in iOS Device Development workflow.
- `show-build-settings` - Defined in iOS Device Development workflow.
- `stop` - Stop macOS app.
- `test` - Test macOS target.



### MCP Doctor (`doctor`)
**Purpose**: Diagnostic tool providing comprehensive information about the MCP server environment, dependencies, and configuration. (1 tools)

- `doctor` - MCP environment info.



### Project Discovery (`project-discovery`)
**Purpose**: Discover and examine Xcode projects, workspaces, and Swift packages. Analyze project structure, schemes, build settings, and bundle information. (5 tools)

- `discover-projects` - Defined in iOS Device Development workflow.
- `get-app-bundle-id` - Defined in iOS Device Development workflow.
- `get-macos-bundle-id` - Defined in macOS Development workflow.
- `list-schemes` - Defined in iOS Device Development workflow.
- `show-build-settings` - Defined in iOS Device Development workflow.



### Project Scaffolding (`project-scaffolding`)
**Purpose**: Scaffold new iOS and macOS projects from templates. (2 tools)

- `scaffold-ios` - Scaffold iOS project.
- `scaffold-macos` - Scaffold macOS project.



### Simulator Management (`simulator-management`)
**Purpose**: Tools for managing simulators from booting, opening simulators, listing simulators, stopping simulators, erasing simulator content and settings, and setting simulator environment options like location, network, statusbar and appearance. (8 tools)

- `boot` - Boot iOS simulator for manual/non-build flows. Not required before simulator build-and-run (build_run_sim).
- `erase` - Erase simulator.
- `list` - List iOS simulators.
- `open` - Open Simulator.app for visibility/manual workflows. Not required before simulator build-and-run (build_run_sim).
- `reset-location` - Reset sim location.
- `set-appearance` - Set sim appearance.
- `set-location` - Set sim location.
- `statusbar` - Set sim status bar network.



### Swift Package Development (`swift-package`)
**Purpose**: Build, test, run and manage Swift Package Manager projects. (8 tools)

- `build` - swift package target build.
- `clean` - swift package clean.
- `get-coverage-report` - Defined in Code Coverage workflow.
- `get-file-coverage` - Defined in Code Coverage workflow.
- `list` - List SwiftPM processes.
- `run` - swift package target run.
- `stop` - Stop SwiftPM run.
- `test` - Run swift package target tests.



### UI Automation (`ui-automation`)
**Purpose**: UI automation and accessibility testing tools for iOS simulators. Perform gestures, interactions, screenshots, and UI analysis for automated testing workflows. (11 tools)

- `button` - Press simulator hardware button.
- `gesture` - Simulator gesture preset.
- `key-press` - Press key by keycode.
- `key-sequence` - Press a sequence of keys by their keycodes.
- `long-press` - Long press at coords.
- `screenshot` - Defined in iOS Simulator Development workflow.
- `snapshot-ui` - Defined in iOS Simulator Development workflow.
- `swipe` - Swipe between points.
- `tap` - Tap UI element by accessibility id/label (recommended) or coordinates as fallback.
- `touch` - Touch down/up at coords.
- `type-text` - Type text.



### Xcode IDE Integration (`xcode-ide`)
**Purpose**: Bridge tools for connecting to Xcode's built-in MCP server (mcpbridge) to access IDE-specific functionality. (5 tools)

- `bridge-disconnect` - Disconnect bridge and unregister proxied `xcode_tools_*` tools.
- `bridge-status` - Show xcrun mcpbridge availability and proxy tool sync status.
- `bridge-sync` - One-shot connect + tools/list sync (manual retry; avoids background prompt spam).
- `call-tool` - Call a remote Xcode IDE MCP tool.
- `list-tools` - Lists Xcode-IDE-only MCP capabilities (Use for: SwiftUI previews image capture, code snippet execution, issue Navigator/build logs, and window/tab context).



## Summary Statistics

- **Canonical Tools**: 71
- **Total Tools**: 99
- **Workflow Groups**: 13

---

*This documentation is automatically generated by `scripts/update-tools-docs.ts` from the tools manifest. Last updated: 2026-04-24T09:29:18.061Z UTC*
