# Changelog

## [Unreleased]

### Added

- Added `xcodebuildmcp upgrade` command to check for updates and upgrade in place. Supports `--check` (report-only) and `--yes`/`-y` (skip confirmation). Detects install method (Homebrew, npm-global, npx) and queries the appropriate channel source (`brew info`, `npm view`, or GitHub Releases) for the latest version. Non-interactive environments exit 1 when an auto-upgrade is possible but `--yes` was not supplied.
- Added platform selection step to the `xcodebuildmcp setup` wizard. You now choose which platforms you are developing for (macOS, iOS, tvOS, watchOS, visionOS) before selecting workflows. Based on the selection, the wizard automatically recommends the appropriate workflow set ([#281](https://github.com/getsentry/XcodeBuildMCP/pull/281) by [@detailobsessed](https://github.com/detailobsessed)).

### Changed

- The `setup` wizard no longer prompts for a simulator or device when macOS is the only selected platform — macOS apps run natively and do not require a simulator or physical device ([#281](https://github.com/getsentry/XcodeBuildMCP/pull/281) by [@detailobsessed](https://github.com/detailobsessed)).
- When a single platform is selected, `xcodebuildmcp setup` now writes `platform` to `sessionDefaults` in `config.yaml` and includes `XCODEBUILDMCP_PLATFORM` in `--format mcp-json` output. For multi-platform projects the platform key is omitted so the agent can choose per-command ([#281](https://github.com/getsentry/XcodeBuildMCP/pull/281) by [@detailobsessed](https://github.com/detailobsessed)).
- The `setup` wizard remembers previous choices on re-run: existing `config.yaml` values (including the new `platform`) are pre-loaded as defaults for every prompt ([#281](https://github.com/getsentry/XcodeBuildMCP/pull/281) by [@detailobsessed](https://github.com/detailobsessed)).

## [2.3.2]

### Fixed

- Improved reliability of internal telemetry during shutdown ([#302](https://github.com/getsentry/XcodeBuildMCP/pull/302)).

## [2.3.1]

### Fixed

- Fixed unnecessary tool confirmation prompts in MCP clients (such as Codex) that treat missing approval annotations as high-risk defaults ([#297](https://github.com/getsentry/XcodeBuildMCP/pull/297)).

## [2.3.0]

### Added

- Added environment variable support for session defaults (e.g. `XCODEBUILDMCP_WORKSPACE_PATH`, `XCODEBUILDMCP_SCHEME`, `XCODEBUILDMCP_PLATFORM`) so MCP clients can supply startup defaults in their config without a project config file ([#268](https://github.com/getsentry/XcodeBuildMCP/pull/268) by [@detailobsessed](https://github.com/detailobsessed)). See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#environment-variables).
- Added `--format mcp-json` flag to `xcodebuildmcp setup` that exports an env-based MCP client config block instead of writing `config.yaml` ([#268](https://github.com/getsentry/XcodeBuildMCP/pull/268) by [@detailobsessed](https://github.com/detailobsessed)).

### Changed

- Clarified configuration layering: `session_set_defaults` overrides `config.yaml`, which overrides environment variables. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) ([#268](https://github.com/getsentry/XcodeBuildMCP/pull/268) by [@detailobsessed](https://github.com/detailobsessed)).
- Improved `xcodebuildmcp setup` reliability when optional targets (like physical devices) are unavailable.

### Fixed

- Fixed `.xcodebuildmcp/config.yaml` being modified on startup when simulator metadata was refreshed ([#230](https://github.com/getsentry/XcodeBuildMCP/issues/230)).
- Fixed orphaned MCP server processes that could remain running after the client disconnects ([#273](https://github.com/getsentry/XcodeBuildMCP/issues/273)).
- Fixed `list-schemes` CLI command missing `--project-path` and `--workspace-path` flags ([#271](https://github.com/getsentry/XcodeBuildMCP/pull/271)).
- Fixed Xcode IDE workflow tools not working when invoked from the CLI.
- Fixed Swift Package tools not properly waiting for process exit when stopping.

## [2.2.1]

- Fix AXe bundling issue.

## [2.2.0]

### Added

- Added `get_coverage_report` and `get_file_coverage` tools for inspecting code coverage from test results — view per-target summaries or drill into function-level coverage and uncovered line ranges for specific files ([#240](https://github.com/getsentry/XcodeBuildMCP/pull/240) by [@irangareddy](https://github.com/irangareddy)). See [docs/TOOLS.md](docs/TOOLS.md).
- Added a unified build-and-run command for physical devices, matching the existing simulator workflow so agents can build and launch device apps in a single step.
- Added an interactive setup wizard via `xcodebuildmcp setup` that walks you through creating or updating `.xcodebuildmcp/config.yaml` — select workflows, pick a simulator, set your scheme and project, and configure debug options without editing YAML by hand. Non-interactive mode remains available for CI and scripting. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

  ```bash
  xcodebuildmcp setup
  ```
- Added `AGENTS.md` generation to the `init` command, providing prescriptive agent workflow instructions for your project.
- Added support for custom workflows in `.xcodebuildmcp/config.yaml`. Define your own workflow names and map them to an explicit list of tools, then reference them from `enabledWorkflows` like any built-in workflow. This lets you limit the tools your agent sees to exactly the ones you need. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#custom-workflows).

  ```yaml
  enabledWorkflows: ["my-workflow"]
  customWorkflows:
    my-workflow:
      - build_run_sim
      - record_sim_video
      - screenshot
  ```
- Added AdaL CLI setup instructions ([#242](https://github.com/getsentry/XcodeBuildMCP/pull/242) by [@Abdulrahmansoliman](https://github.com/Abdulrahmansoliman)).

### Changed

- CLI now auto-fills tool arguments from session defaults. If your config file sets a scheme, project path, or simulator, every CLI command picks those up automatically — no need to repeat `--scheme`, `--project-path`, and similar flags on every invocation. See [docs/CLI.md](docs/CLI.md).

  ```yaml
  # .xcodebuildmcp/config.yaml
  sessionDefaults:
    scheme: MyApp
    projectPath: ./MyApp.xcodeproj
    simulatorName: iPhone 17 Pro
  ```

  ```bash
  # Before: every command needed explicit flags
  xcodebuildmcp simulator build --scheme MyApp --project-path ./MyApp.xcodeproj

  # Now: flags are filled from session defaults
  xcodebuildmcp simulator build
  ```

  This also works with session defaults profiles, which is especially useful for monorepos. Define a profile per sub-project and the CLI uses the active profile's values. Override the profile for a single command with `--profile`. See [docs/SESSION_DEFAULTS.md](docs/SESSION_DEFAULTS.md#namespaced-profiles).

  ```yaml
  # .xcodebuildmcp/config.yaml
  schemaVersion: 1
  sessionDefaultsProfiles:
    calculator:
      workspacePath: ./iOS_Calculator/CalculatorApp.xcworkspace
      scheme: CalculatorApp
      simulatorName: iPhone 17 Pro
    ios-test:
      projectPath: ./iOS/MCPTest.xcodeproj
      scheme: MCPTest
      simulatorName: iPhone 17 Pro
    spm:
      projectPath: ./spm
      scheme: spm
  activeSessionDefaultsProfile: calculator
  ```

  ```bash
  # Build using the active profile (calculator)
  xcodebuildmcp simulator build-and-run

  # Build a different sub-project without switching the active profile
  xcodebuildmcp simulator build-and-run --profile ios-test
  ```
- Default simulator updated from iPhone 16 to iPhone 17.
- Tool annotations now more accurately classify operations, reducing unnecessary confirmation prompts in MCP clients that respect annotations ([#253](https://github.com/getsentry/XcodeBuildMCP/pull/253) by [@saschagordner](https://github.com/saschagordner)).
- Improved agent workflow guidance with more prescriptive instructions for common tasks.
- Bundled AXe updated to 1.5.2.

### Fixed

- Fixed Swift Package tools (`swift_package_build`, `swift_package_test`, `swift_package_clean`) hiding compiler diagnostics when stderr was empty ([#255](https://github.com/getsentry/XcodeBuildMCP/pull/255) by [@doovers](https://github.com/doovers)).
- Fixed stderr warnings (e.g. "multiple matching destinations") hiding actual test failures by prioritizing xcresult output when available ([#254](https://github.com/getsentry/XcodeBuildMCP/pull/254) by [@czottmann](https://github.com/czottmann)).

Various other internal improvements to stability, performance, and code quality.

## [2.1.0]

### Added

- Added `xcodebuildmcp init` CLI command to install agent skills, replacing the standalone `install-skill.sh` script. Supports auto-detection of AI clients (Claude Code, Cursor, Codex), `--print` for unsupported clients, and `--uninstall` for removal. See [docs/SKILLS.md](docs/SKILLS.md#install).
- Added namespaced session defaults profiles, letting you save and switch between different project/scheme/simulator configurations without reconfiguring each time. See [docs/SESSION_DEFAULTS.md](docs/SESSION_DEFAULTS.md#namespaced-profiles).
- Added support for persisting custom environment variables in session defaults ([#235](https://github.com/getsentry/XcodeBuildMCP/pull/235) by [@kamal](https://github.com/kamal)). See [docs/SESSION_DEFAULTS.md](docs/SESSION_DEFAULTS.md#persisting-defaults).
- Added Kiro client setup instructions ([#222](https://github.com/getsentry/XcodeBuildMCP/pull/222) by [@manojmahapatra](https://github.com/manojmahapatra)).

### Added

- Added `get_coverage_report` tool to show per-target code coverage from xcresult bundles ([#227](https://github.com/getsentry/XcodeBuildMCP/issues/227))
- Added `get_file_coverage` tool to show function-level coverage and uncovered line ranges for specific files ([#227](https://github.com/getsentry/XcodeBuildMCP/issues/227))

### Changed

- Faster MCP startup when the Xcode IDE workflow is enabled — tools are available sooner after connecting ([#210](https://github.com/getsentry/XcodeBuildMCP/issues/210)). See [docs/XCODE_IDE_MCPBRIDGE.md](docs/XCODE_IDE_MCPBRIDGE.md).
- Agents now use the combined build-and-run tool for simulator run intents, avoiding a redundant separate build step.
- Improved next-step suggestions so agents receive more accurate follow-up actions after each tool call.
- Updated UI automation tap guidance to prefer label and ID targets, reducing agent errors.

### Fixed

- Fixed false positive error and warning detection when build output contained echoed source code ([#218](https://github.com/getsentry/XcodeBuildMCP/pull/218) by [@nebooz](https://github.com/nebooz)).
- Fixed outdated tool names and parameters in the CLI skill file ([#217](https://github.com/getsentry/XcodeBuildMCP/pull/217) by [@pocketpixels](https://github.com/pocketpixels)).
- Fixed Sentry telemetry scope to capture only internal runtime failures, removing unnecessary data collection ([#204](https://github.com/getsentry/XcodeBuildMCP/issues/204)).
- Fixed a shell injection vulnerability in the release workflow ([#229](https://github.com/getsentry/XcodeBuildMCP/pull/229)).
- Improved privacy redaction in the `doctor` command to better protect project names and paths in default output.

### Removed

- Removed `scripts/install-skill.sh` in favour of `xcodebuildmcp init`.

Various other internal improvements to stability, performance, and code quality.

## [2.0.7]

### Changed

- XcodeBuildMCP has moved to the [getsentry](https://github.com/getsentry) GitHub organization. Homebrew users should switch to the new tap: `brew untap cameroncooke/xcodebuildmcp && brew tap getsentry/xcodebuildmcp`. npm and npx users are unaffected.

## [2.0.5] - 2026-02-10

### Added

- Homebrew installation (`brew tap getsentry/xcodebuildmcp && brew install xcodebuildmcp`) — installs a self-contained binary with no Node.js dependency.

### Removed

- Smithery distribution channel.

## [2.0.0]

### New! CLI

XcodeBuildMCP now includes a first-class CLI for direct terminal usage, scripting, and CI workflows. All the same tools available via MCP are accessible from the command line.

```bash
npm install -g xcodebuildmcp@beta
xcodebuildmcp tools # List available tools
xcodebuildmcp simulator build-and-run --scheme MyApp --project-path ./MyApp.xcodeproj
```

Stateful operations (log capture, debugging, video recording) are backed by a per-workspace background process that starts automatically and shuts down after idle. See [docs/CLI.md](docs/CLI.md) for full documentation.

### New! Configuration File

Project-level configuration via `.xcodebuildmcp/config.yaml` replaces the need for environment variables. Set your project path, scheme, simulator, enabled workflows, debug settings, and more in one place. Environment variables still work but the config file takes precedence.

```yaml
schemaVersion: 1
enabledWorkflows:
  - simulator
  - ui-automation
  - debugging
sessionDefaults:
  scheme: MyApp
  projectPath: ./MyApp.xcodeproj
  simulatorName: iPhone 17
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full reference.

### New! Xcode IDE Integration

XcodeBuildMCP can now proxy tools from Xcode 26.3's built-in MCP bridge, giving your agent access to Xcode IDE capabilities like Preview rendering, the Issue Navigator, and documentation search. Enable the `xcode-ide` workflow to use this. Setup instructions for both Codex Agent and Claude Code Agent in Xcode are included. See [docs/XCODE_IDE_MCPBRIDGE.md](docs/XCODE_IDE_MCPBRIDGE.md) for details.

### Added

- **LLDB Debugging**: Attach a debugger to simulator apps, set breakpoints, inspect variables, view the call stack, and run LLDB commands — all through your agent. Supports both DAP and LLDB-CLI backends. See [docs/TOOLS.md](docs/TOOLS.md) for the debugging tools.
- **Session default persistence**: Session defaults can now be saved to the config file with `persist: true`, so your preferred project, scheme, and simulator are remembered across sessions.
- **Log subsystem filtering**: Filter simulator log capture by subsystem — choose `app` (default), `all`, `swiftui` (for `Self._printChanges()` output), or a custom list of subsystems.
- **Agent skills**: Optional skill files that prime your agent with usage instructions for the MCP server or CLI. Install via the provided shell script or manually. See [docs/SKILLS.md](docs/SKILLS.md).
- **MCP tool annotations**: All tools now include MCP-standard annotations (read-only vs. destructive, idempotent, etc.) for clients that support them.
- **Simulator name resolution**: Session defaults now accept a simulator name and automatically resolve it to a device ID.
- **Launch environment variables**: Launch tools now accept an optional `env` object so you can pass runtime environment variables when starting apps on simulator or device.

### Changed

- Simulator tools are now the default workflow. Previously all workflows loaded by default, increasing context usage.
- Bundled AXe updated to 1.3.0.
- Landscape screenshots now orient correctly.
- Simulator platform detection and default refresh behavior are more reliable, so simulator commands stay aligned with your current defaults as they change.

### Fixed

- Fixed incremental builds corrupting arguments when strings contained substrings matching build flags.
- Fixed build path handling so relative project, workspace, and derived data paths resolve correctly even when commands run from different working directories.
- Fixed working-directory leakage in incremental build setup that could affect concurrent requests.
- Fixed simulator screenshot matching for similarly named devices (for example, `iPhone 15` and `iPhone 15 Pro`).

## [1.15.1] - 2025-12-20

### Changed
- Add suppressWarnings to suppress warnings from the build tools.
- Update AXe to 1.2.0
- Update tap tool to accept label/id as tap targets.

## [1.15.0] - 2025-12-15

### Added
- Add support for in-memory session defaults.

### Changed
- Various bug fixes and improvements

## [1.14.0] - 2025-09-22
- Add video capture tool for simulators

## [1.13.1] - 2025-09-21
- Add simulator erase content and settings tool

## [1.12.3] - 2025-08-22
- Pass environment variables to test runs on device, simulator, and macOS via an optional testRunnerEnv input (auto-prefixed as TEST_RUNNER_).

## [1.12.2] - 2025-08-21
### Fixed
- **Clean tool**: Fixed issue where clean would fail for simulators

## [1.12.1] - 2025-08-18
### Improved
- **Sentry Logging**: No longer logs domain errors to Sentry, now only logs MCP server errors.

## [1.12.0] - 2025-08-17
### Added
- Unify project/workspace and sim id/name tools into a single tools reducing the number of tools from 81 to 59, this helps reduce the client agent's context window size by 27%!
- **Selective Workflow Loading**: New `XCODEBUILDMCP_ENABLED_WORKFLOWS` environment variable allows loading only specific workflow groups in static mode, reducing context window usage for clients that don't support MCP sampling (Thanks to @codeman9 for their first contribution!)
- Rename `diagnosics` tool and cli to `doctor`
- Add Sentry instrumentation to track MCP usage statistics (can be disabled by setting `XCODEBUILDMCP_SENTRY_DISABLED=true`)
- Add support for MCP setLevel handler to allow clients to control the log level of the MCP server

## [v1.11.2] - 2025-08-08
- Fixed "registerTools is not a function" errors during package upgrades

## [v1.11.1] - 2025-08-07
- Improved tool discovery to be more accurate and context-aware

## [v1.11.0] - 2025-08-07
- Major refactor/rewrite to improve code quality and maintainability in preparation for future development
- Added support for dynamic tools (VSCode only for now)
- Added support for MCP Resources (devices, simulators, environment info)
- Workaround for https://github.com/cameroncooke/XcodeBuildMCP/issues/66 and https://github.com/anthropics/claude-code/issues/1804 issues where Claude Code would only see the first text content from tool responses

## [v1.10.0] - 2025-06-10
### Added
- **App Lifecycle Management**: New tools for stopping running applications
  - `stop_app_device`: Stop apps running on physical Apple devices (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro)
  - `stop_app_sim`: Stop apps running on iOS/watchOS/tvOS/visionOS simulators
  - `stop_mac_app`: Stop macOS applications by name or process ID
- **Enhanced Launch Tools**: Device launch tools now return process IDs for better app management
- **Bundled AXe Distribution**: AXe binary and frameworks now included in npm package for zero-setup UI automation

### Fixed
- **WiFi Device Detection**: Improved detection of Apple devices connected over WiFi networks
- **Device Connectivity**: Better handling of paired devices with different connection states

### Improved
- **Simplified Installation**: No separate AXe installation required - everything works out of the box

## [v1.9.0] - 2025-06-09
- Added support for hardware devices over USB and Wi-Fi
- New tools for Apple device deployment:
  - `install_app_device`
  - `launch_app_device`
- Updated all simulator and device tools to be platform-agnostic, supporting all Apple platforms (iOS, iPadOS, watchOS, tvOS, visionOS)
- Changed `get_ios_bundle_id` to `get_app_bundle_id` with support for all Apple platforms

## [v1.8.0] - 2025-06-07
- Added support for running tests on macOS, iOS simulators, and iOS devices
- New tools for testing:
  - `test_macos_workspace`
  - `test_macos_project`
  - `test_ios_simulator_name_workspace`
  - `test_ios_simulator_name_project`
  - `test_ios_simulator_id_workspace`
  - `test_ios_simulator_id_project`
  - `test_ios_device_workspace`
  - `test_ios_device_project`

## [v1.7.0] - 2025-06-04
- Added support for Swift Package Manager (SPM)
- New tools for Swift Package Manager:
  - `swift_package_build`
  - `swift_package_clean`
  - `swift_package_test`
  - `swift_package_run`
  - `swift_package_list`
  - `swift_package_stop`

## [v1.6.1] - 2025-06-03
- Improve UI tool hints

## [v1.6.0] - 2025-06-03
- Moved project templates to external GitHub repositories for independent versioning
- Added support for downloading templates from GitHub releases
- Added local template override support via environment variables
- Added `scaffold_ios_project` and `scaffold_macos_project` tools for creating new projects
- Centralized template version management in package.json for easier updates

## [v1.5.0] - 2025-06-01
- UI automation is no longer in beta!
- Added support for AXe UI automation
- Revised default installation instructions to prefer npx instead of mise

## [v1.4.0] - 2025-05-11
- Merge the incremental build beta branch into main
- Add preferXcodebuild argument to build tools with improved error handling allowing the agent to force the use of xcodebuild over xcodemake for complex projects. It also adds a hint when incremental builds fail due to non-compiler errors, enabling the agent to automatically switch to xcodebuild for a recovery build attempt, improving reliability.

## [v1.3.7] - 2025-05-08
- Fix Claude Code issue due to long tool names

## [v1.4.0-beta.3] - 2025-05-07
- Fixed issue where incremental builds would only work for "Debug" build configurations
-
## [v1.4.0-beta.2] - 2025-05-07
- Same as beta 1 but has the latest features from the main release channel

## [v1.4.0-beta.1] - 2025-05-05
- Added experimental support for incremental builds (requires opt-in)

## [v1.3.6] - 2025-05-07
- Added support for enabling/disabling tools via environment variables

## [v1.3.5] - 2025-05-05
- Fixed the text input UI automation tool
- Improve the UI automation tool hints to reduce agent tool call errors
- Improved the project discovery tool to reduce agent tool call errors
- Added instructions for installing idb client manually

## [v1.3.4] - 2025-05-04
- Improved Sentry integration

## [v1.3.3] - 2025-05-04
- Added Sentry opt-out functionality

## [v1.3.1] - 2025-05-03
- Added Sentry integration for error reporting

## [v1.3.0] - 2025-04-28

- Added support for interacting with the simulator (tap, swipe etc.)
- Added support for capturing simulator screenshots

Please note that the UI automation features are an early preview and currently in beta your mileage may vary.

## [v1.2.4] - 2025-04-24
- Improved xcodebuild reporting of warnings and errors in tool response
- Refactor build utils and remove redundant code

## [v1.2.3] - 2025-04-23
- Added support for skipping macro validation

## [v1.2.2] - 2025-04-23
- Improved log readability with version information for easier debugging
- Enhanced overall stability and performance

## [v1.2.1] - 2025-04-23
- General stability improvements and bug fixes

## [v1.2.0] - 2025-04-14
### Added
- New simulator log capture feature: Easily view and debug your app's logs while running in the simulator
- Automatic project discovery: XcodeBuildMCP now finds your Xcode projects and workspaces automatically
- Support for both Intel and Apple Silicon Macs in macOS builds

### Improved
- Cleaner, more readable build output with better error messages
- Faster build times and more reliable build process
- Enhanced documentation with clearer usage examples

## [v1.1.0] - 2025-04-05
### Added
- Real-time build progress reporting
- Separate tools for iOS and macOS builds
- Better workspace and project support

### Improved
- Simplified build commands with better parameter handling
- More reliable clean operations for both projects and workspaces

## [v1.0.2] - 2025-04-02
- Improved documentation with better examples and clearer instructions
- Easier version tracking for compatibility checks

## [v1.0.1] - 2025-04-02
- Initial release of XcodeBuildMCP
- Basic support for building iOS and macOS applications


