# XcodeBuildMCP MCP Tools Reference

This document lists MCP tool names as exposed to MCP clients. XcodeBuildMCP provides 79 canonical tools organized into 15 workflow groups for comprehensive Apple development workflows.

## Workflow Groups

### Build Utilities (`utilities`)
**Purpose**: Utility tools for cleaning build products and managing build artifacts. (1 tools)

- `clean` - Defined in iOS Device Development workflow.



### iOS Device Development (`device`)
**Purpose**: Complete iOS development workflow for physical devices (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro). (14 tools)

- `build_device` - Build for device.
- `clean` - Clean build products.
- `discover_projs` - Scans a directory (defaults to workspace root) to find Xcode project (.xcodeproj) and workspace (.xcworkspace) files.
- `get_app_bundle_id` - Extract bundle id from .app.
- `get_device_app_path` - Get device built app path.
- `install_app_device` - Install app on device.
- `launch_app_device` - Launch app on device.
- `list_devices` - List connected devices.
- `list_schemes` - List Xcode schemes.
- `show_build_settings` - Show build settings.
- `start_device_log_cap` - Start device log capture.
- `stop_app_device` - Stop device app.
- `stop_device_log_cap` - Stop device app and return logs.
- `test_device` - Test on device.



### iOS Simulator Development (`simulator`)
**Purpose**: Complete iOS development workflow for both .xcodeproj and .xcworkspace files targeting simulators. (21 tools)

- `boot_sim` - Defined in Simulator Management workflow.
- `build_run_sim` - Build and run iOS sim (preferred for run/launch intent).
- `build_sim` - Build for iOS sim (compile-only, no launch).
- `clean` - Defined in iOS Device Development workflow.
- `discover_projs` - Defined in iOS Device Development workflow.
- `get_app_bundle_id` - Defined in iOS Device Development workflow.
- `get_sim_app_path` - Get sim built app path.
- `install_app_sim` - Install app on sim.
- `launch_app_logs_sim` - Launch sim app with logs.
- `launch_app_sim` - Launch app on simulator.
- `list_schemes` - Defined in iOS Device Development workflow.
- `list_sims` - Defined in Simulator Management workflow.
- `open_sim` - Defined in Simulator Management workflow.
- `record_sim_video` - Record sim video.
- `screenshot` - Capture screenshot.
- `show_build_settings` - Defined in iOS Device Development workflow.
- `snapshot_ui` - Print view hierarchy with precise view coordinates (x, y, width, height) for visible elements.
- `start_sim_log_cap` - Defined in Log Capture workflow.
- `stop_app_sim` - Stop sim app.
- `stop_sim_log_cap` - Defined in Log Capture workflow.
- `test_sim` - Test on iOS sim.



### LLDB Debugging (`debugging`)
**Purpose**: Attach LLDB debugger to simulator apps, set breakpoints, inspect variables and call stacks. (8 tools)

- `debug_attach_sim` - Attach LLDB to sim app.
- `debug_breakpoint_add` - Add breakpoint.
- `debug_breakpoint_remove` - Remove breakpoint.
- `debug_continue` - Continue debug session.
- `debug_detach` - Detach debugger.
- `debug_lldb_command` - Run LLDB command.
- `debug_stack` - Get backtrace.
- `debug_variables` - Get frame variables.



### Log Capture (`logging`)
**Purpose**: Capture and retrieve logs from simulator and device apps. (4 tools)

- `start_device_log_cap` - Defined in iOS Device Development workflow.
- `start_sim_log_cap` - Start sim log capture.
- `stop_device_log_cap` - Defined in iOS Device Development workflow.
- `stop_sim_log_cap` - Stop sim app and return logs.



### macOS Development (`macos`)
**Purpose**: Complete macOS development workflow for both .xcodeproj and .xcworkspace files. Build, test, deploy, and manage macOS applications. (11 tools)

- `build_macos` - Build macOS app.
- `build_run_macos` - Build and run macOS app.
- `clean` - Defined in iOS Device Development workflow.
- `discover_projs` - Defined in iOS Device Development workflow.
- `get_mac_app_path` - Get macOS built app path.
- `get_mac_bundle_id` - Extract bundle id from macOS .app.
- `launch_mac_app` - Launch macOS app.
- `list_schemes` - Defined in iOS Device Development workflow.
- `show_build_settings` - Defined in iOS Device Development workflow.
- `stop_mac_app` - Stop macOS app.
- `test_macos` - Test macOS target.



### MCP Doctor (`doctor`)
**Purpose**: Diagnostic tool providing comprehensive information about the MCP server environment, dependencies, and configuration. (1 tools)

- `doctor` - MCP environment info.



### Project Discovery (`project-discovery`)
**Purpose**: Discover and examine Xcode projects, workspaces, and Swift packages. Analyze project structure, schemes, build settings, and bundle information. (5 tools)

- `discover_projs` - Defined in iOS Device Development workflow.
- `get_app_bundle_id` - Defined in iOS Device Development workflow.
- `get_mac_bundle_id` - Defined in macOS Development workflow.
- `list_schemes` - Defined in iOS Device Development workflow.
- `show_build_settings` - Defined in iOS Device Development workflow.



### Project Scaffolding (`project-scaffolding`)
**Purpose**: Scaffold new iOS and macOS projects from templates. (2 tools)

- `scaffold_ios_project` - Scaffold iOS project.
- `scaffold_macos_project` - Scaffold macOS project.



### Session Management (`session-management`)
**Purpose**: Manage session defaults for project/workspace paths, scheme, configuration, simulator/device settings. (5 tools)

- `session_clear_defaults` - Clear session defaults for the active profile or a specified profile.
- `session_set_defaults` - Set session defaults for the active profile, or for a specified profile and make it active.
- `session_show_defaults` - Show the current active defaults.
- `session_use_defaults_profile` - Switch the active session defaults profile.
- `sync_xcode_defaults` - Sync session defaults (scheme, simulator) from Xcode's current IDE selection.



### Simulator Management (`simulator-management`)
**Purpose**: Tools for managing simulators from booting, opening simulators, listing simulators, stopping simulators, erasing simulator content and settings, and setting simulator environment options like location, network, statusbar and appearance. (8 tools)

- `boot_sim` - Boot iOS simulator.
- `erase_sims` - Erase simulator.
- `list_sims` - List iOS simulators.
- `open_sim` - Open Simulator app.
- `reset_sim_location` - Reset sim location.
- `set_sim_appearance` - Set sim appearance.
- `set_sim_location` - Set sim location.
- `sim_statusbar` - Set sim status bar network.



### Swift Package Development (`swift-package`)
**Purpose**: Build, test, run and manage Swift Package Manager projects. (6 tools)

- `swift_package_build` - swift package target build.
- `swift_package_clean` - swift package clean.
- `swift_package_list` - List SwiftPM processes.
- `swift_package_run` - swift package target run.
- `swift_package_stop` - Stop SwiftPM run.
- `swift_package_test` - Run swift package target tests.



### UI Automation (`ui-automation`)
**Purpose**: UI automation and accessibility testing tools for iOS simulators. Perform gestures, interactions, screenshots, and UI analysis for automated testing workflows. (11 tools)

- `button` - Press simulator hardware button.
- `gesture` - Simulator gesture preset.
- `key_press` - Press key by keycode.
- `key_sequence` - Press a sequence of keys by their keycodes.
- `long_press` - Long press at coords.
- `screenshot` - Defined in iOS Simulator Development workflow.
- `snapshot_ui` - Defined in iOS Simulator Development workflow.
- `swipe` - Swipe between points.
- `tap` - Tap UI element by accessibility id/label (recommended) or coordinates as fallback.
- `touch` - Touch down/up at coords.
- `type_text` - Type text.



### Workflow Discovery (`workflow-discovery`)
**Purpose**: Manage enabled workflows at runtime. (1 tools)

- `manage-workflows` - Workflows are groups of tools exposed by XcodeBuildMCP. By default, not all workflows (and therefore tools) are enabled; only simulator tools are enabled by default. Some workflows are mandatory and can't be disabled.



### Xcode IDE Integration (`xcode-ide`)
**Purpose**: Bridge tools for connecting to Xcode's built-in MCP server (mcpbridge) to access IDE-specific functionality. (5 tools)

- `xcode_ide_call_tool` - Call a remote Xcode IDE MCP tool.
- `xcode_ide_list_tools` - Lists Xcode-IDE-only MCP capabilities (Use for: SwiftUI previews image capture, code snippet execution, issue Navigator/build logs, and window/tab context).
- `xcode_tools_bridge_disconnect` - Disconnect bridge and unregister proxied `xcode_tools_*` tools.
- `xcode_tools_bridge_status` - Show xcrun mcpbridge availability and proxy tool sync status.
- `xcode_tools_bridge_sync` - One-shot connect + tools/list sync (manual retry; avoids background prompt spam).



## Summary Statistics

- **Canonical Tools**: 79
- **Total Tools**: 103
- **Workflow Groups**: 15

---

*This documentation is automatically generated by `scripts/update-tools-docs.ts` from the tools manifest. Last updated: 2026-02-22T18:16:55.247Z UTC*
