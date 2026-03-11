# Configuration

XcodeBuildMCP reads configuration from environment variables and/or a project config file. Both are optional but provide deterministic behavior for every session.

## Contents

- [Config file](#config-file)
- [Configuration layering](#configuration-layering)
- [Environment variables](#environment-variables)
- [Session defaults](#session-defaults)
- [Workflow selection](#workflow-selection)
- [Build settings](#build-settings)
- [Debugging and logging](#debugging-and-logging)
- [UI automation](#ui-automation)
- [Templates](#templates)
- [Telemetry](#telemetry)
- [Quick reference](#quick-reference)

---

## Config file

The config file provides repo-scoped, version-controllable configuration. Create it at your workspace root:

```
<workspace-root>/.xcodebuildmcp/config.yaml
```

Or run the interactive setup wizard:

```bash
xcodebuildmcp setup
```

Minimal example:

```yaml
schemaVersion: 1
enabledWorkflows: ["simulator", "ui-automation", "debugging"]
```

Full example options:

```yaml
schemaVersion: 1

# Workflow selection
enabledWorkflows: ["simulator", "ui-automation", "debugging"]
customWorkflows:
  my-workflow:
    - build_run_sim
    - record_sim_video
    - screenshot
experimentalWorkflowDiscovery: false

# Session defaults
disableSessionDefaults: false
sessionDefaults:
  projectPath: "./MyApp.xcodeproj"
  scheme: "MyApp"
  configuration: "Debug"
  simulatorName: "iPhone 17"
  platform: "iOS"
  useLatestOS: true
  arch: "arm64"
  suppressWarnings: true
  derivedDataPath: "./.derivedData"
  preferXcodebuild: false
  bundleId: "io.sentry.myapp"

# Build settings
incrementalBuildsEnabled: false

# Debugging
debug: false
sentryDisabled: false
debuggerBackend: "dap"
dapRequestTimeoutMs: 30000
dapLogEvents: false
launchJsonWaitMs: 8000

# UI automation
uiDebuggerGuardMode: "error"
axePath: "/opt/axe/bin/axe"

# Templates
iosTemplatePath: "/path/to/ios/templates"
iosTemplateVersion: "v1.2.3"
macosTemplatePath: "/path/to/macos/templates"
macosTemplateVersion: "v1.2.3"
```

The `schemaVersion` field is required and currently only supports `1`.

---

## Session defaults

Session defaults allow you to set shared values once (project, scheme, simulator, etc.) that all tools reuse automatically. This reduces token usage and ensures consistent behavior.

### Enabling and disabling

Session defaults are enabled by default. To disable them:

```yaml
disableSessionDefaults: true
```

When disabled, agents must pass explicit parameters on every tool call (legacy behavior).

### Setting defaults from config

Seed defaults at server startup by adding a `sessionDefaults` block:

```yaml
sessionDefaults:
  projectPath: "./MyApp.xcodeproj"
  scheme: "MyApp"
  configuration: "Debug"
  simulatorName: "iPhone 17"
```

### Setting defaults from an agent

Agents can call `session_set_defaults` at runtime. By default these are stored in memory only. To persist them to the config file, the agent sets `persist: true`.

### Session defaults reference

| Option | Type | Description |
|--------|------|-------------|
| `projectPath` | string | Path to `.xcodeproj` file. Mutually exclusive with `workspacePath`. |
| `workspacePath` | string | Path to `.xcworkspace` file. Takes precedence if both are set. |
| `scheme` | string | Build scheme name. |
| `configuration` | string | Build configuration (e.g., `Debug`, `Release`). |
| `simulatorName` | string | Simulator name (e.g., `iPhone 17`). Mutually exclusive with `simulatorId`. |
| `simulatorId` | string | Simulator UUID. Takes precedence if both are set. |
| `deviceId` | string | Physical device UUID. |
| `platform` | string | Target platform (e.g., `iOS`, `macOS`, `watchOS`, `tvOS`, `visionOS`). |
| `useLatestOS` | boolean | Use the latest available OS version for the simulator. |
| `arch` | string | Build architecture (e.g., `arm64`, `x86_64`). |
| `suppressWarnings` | boolean | Suppress compiler warnings in build output. |
| `derivedDataPath` | string | Custom path for derived data. |
| `preferXcodebuild` | boolean | Use `xcodebuild` instead of the experimental incremental build support (xcodemake). Only applies when incremental builds are enabled. Is designed for agent use to self correct after failed xcodemake build attempts. |
| `bundleId` | string | App bundle identifier. |

### Mutual exclusivity rules

- If both `projectPath` and `workspacePath` are set, `workspacePath` wins.
- If both `simulatorId` and `simulatorName` are set, `simulatorId` wins.

---

## Workflow selection

Workflows determine which tools are available. By default only the `simulator` workflow is loaded.

```yaml
enabledWorkflows: ["simulator", "ui-automation", "debugging"]
```

See [TOOLS.md](TOOLS.md) for available workflows and their tools.

### Custom workflows

You can define your own workflow names in config and reference them from `enabledWorkflows`.
Each custom workflow is a list of tool names (MCP names), and only those tools are loaded for that workflow.

```yaml
enabledWorkflows: ["my-workflow"]
customWorkflows:
  my-workflow:
    - build_run_sim
    - record_sim_video
    - screenshot
```

Notes:
- Built-in implicit workflows are unchanged. Session-management tools are still auto-included, and the doctor workflow is still auto-included when `debug: true`.
- Custom workflow names are normalized to lowercase.
- Unknown tool names are ignored and logged as warnings.

To access Xcode IDE tools (Xcode 26+ `xcrun mcpbridge`), enable `xcode-ide`. This workflow exposes `xcode_ide_list_tools` and `xcode_ide_call_tool` for MCP clients. See [XCODE_IDE_MCPBRIDGE.md](XCODE_IDE_MCPBRIDGE.md).

### Experimental workflow discovery

Enables a `manage-workflows` tool that agents can use to add/remove workflows at runtime.

```yaml
experimentalWorkflowDiscovery: true
```

> [!IMPORTANT]
> Requires client support for tools changed notifications. At the time of writing, Cursor, Claude Code, and Codex do not support this.

---

## Build settings

### Incremental builds

Enable incremental builds to speed up repeated builds:

```yaml
incrementalBuildsEnabled: true
```

> [!IMPORTANT]
> Incremental builds are experimental and may not work for all projects. Agents can bypass this setting per-call if needed.

---

## Debugging and logging

### Debug logging

Enable debug logging and the doctor diagnostic tool:

```yaml
debug: true
```

### Debugger backend

Select the debugger backend:

```yaml
debuggerBackend: "dap"  # or "lldb-cli"
```

Default is `dap`. Changing this is not generally recommended.

### DAP settings

Tune the DAP backend:

```yaml
dapRequestTimeoutMs: 30000  # default: 30000
dapLogEvents: true          # default: false
```

### Device log capture

Control how long to wait for devicectl JSON output:

```yaml
launchJsonWaitMs: 8000  # default: 8000
```

---

## UI automation

### Debugger guard

Block UI automation tools when the debugger is paused to prevent failures:

```yaml
uiDebuggerGuardMode: "error"  # "error" | "warn" | "off"
```

Default is `error`.

### AXe binary

UI automation and simulator video capture require AXe, which is bundled by default. To use a different version:

```yaml
axePath: "/opt/axe/bin/axe"
```

See the [AXe repository](https://github.com/cameroncooke/axe) for more information.

---

## Templates

The scaffold tools pull templates from GitHub. Override the default locations and versions:

```yaml
iosTemplatePath: "/path/to/ios/templates"
iosTemplateVersion: "v1.2.3"
macosTemplatePath: "/path/to/macos/templates"
macosTemplateVersion: "v1.2.3"
```

Default templates:
- iOS: [XcodeBuildMCP-iOS-Template](https://github.com/getsentry/XcodeBuildMCP-iOS-Template)
- macOS: [XcodeBuildMCP-macOS-Template](https://github.com/getsentry/XcodeBuildMCP-macOS-Template)

---

## Telemetry

By default, only internal XcodeBuildMCP runtime failures are sent to Sentry. User-domain errors (such as project build/test/config failures) are not sent. To disable telemetry entirely:

```yaml
sentryDisabled: true
```

You can also disable telemetry via environment variable:

```bash
XCODEBUILDMCP_SENTRY_DISABLED=true
```

See [PRIVACY.md](PRIVACY.md) for more information.

Notes:
- Sentry SDK logging is enabled for internal observability.
- Only explicitly opted-in internal logs are forwarded to Sentry; standard console logs are not auto-forwarded.
- Tool arguments and tool outputs are not captured by MCP wrapper telemetry (`recordInputs: false`, `recordOutputs: false`).

---

## Quick reference

| Option | Type | Default |
|--------|------|---------|
| `schemaVersion` | number | Required (`1`) |
| `enabledWorkflows` | string[] | `["simulator"]` |
| `customWorkflows` | Record<string, string[]> | `{}` |
| `experimentalWorkflowDiscovery` | boolean | `false` |
| `disableSessionDefaults` | boolean | `false` |
| `sessionDefaults` | object | `{}` |
| `incrementalBuildsEnabled` | boolean | `false` |
| `debug` | boolean | `false` |
| `sentryDisabled` | boolean | `false` |
| `debuggerBackend` | string | `"dap"` |
| `dapRequestTimeoutMs` | number | `30000` |
| `dapLogEvents` | boolean | `false` |
| `launchJsonWaitMs` | number | `8000` |
| `uiDebuggerGuardMode` | string | `"error"` |
| `axePath` | string | Bundled |
| `iosTemplatePath` | string | GitHub default |
| `iosTemplateVersion` | string | Bundled version |
| `macosTemplatePath` | string | GitHub default |
| `macosTemplateVersion` | string | Bundled version |

---

## Configuration layering

When multiple configuration sources are present, they are merged with clear precedence:

1. **`session_set_defaults` tool** (highest) — agent runtime overrides, set during a session
2. **Config file** — project-local config (`config.yaml`), committed to repo
3. **Environment variables** (lowest) — MCP client integration, set in `mcp_config.json`

This follows the same pattern as tools like `git config` (`--flag` > `--local` > `--global`). Each layer serves a different context:

- **Config file** is the canonical home for structured, repo-scoped, version-controlled settings.
- **Env vars** are best used to bootstrap flat startup defaults for MCP clients with limited workspace support.
- **Tool calls** are for agent-driven runtime adjustments.

---

## Environment variables

Environment variables are supported for MCP client integration when a client cannot reliably provide workspace context to the server. Set them in the `env` field of your MCP client config (for example `mcp_config.json` for Windsurf, `.vscode/mcp.json` for VS Code, or `claude_desktop_config.json` for Claude Desktop).

Use env vars for flat bootstrap values such as startup workflow selection, project path, scheme, simulator selector, or other scalar defaults. Keep structured project-owned configuration in `config.yaml`.

### General settings

| Config option | Environment variable |
|---------------|---------------------|
| `enabledWorkflows` | `XCODEBUILDMCP_ENABLED_WORKFLOWS` (comma-separated) |
| `experimentalWorkflowDiscovery` | `XCODEBUILDMCP_EXPERIMENTAL_WORKFLOW_DISCOVERY` |
| `disableSessionDefaults` | `XCODEBUILDMCP_DISABLE_SESSION_DEFAULTS` |
| `disableXcodeAutoSync` | `XCODEBUILDMCP_DISABLE_XCODE_AUTO_SYNC` |
| `incrementalBuildsEnabled` | `INCREMENTAL_BUILDS_ENABLED` |
| `debug` | `XCODEBUILDMCP_DEBUG` |
| `sentryDisabled` | `XCODEBUILDMCP_SENTRY_DISABLED` |
| `debuggerBackend` | `XCODEBUILDMCP_DEBUGGER_BACKEND` |
| `dapRequestTimeoutMs` | `XCODEBUILDMCP_DAP_REQUEST_TIMEOUT_MS` |
| `dapLogEvents` | `XCODEBUILDMCP_DAP_LOG_EVENTS` |
| `launchJsonWaitMs` | `XBMCP_LAUNCH_JSON_WAIT_MS` |
| `uiDebuggerGuardMode` | `XCODEBUILDMCP_UI_DEBUGGER_GUARD_MODE` |
| `axePath` | `XCODEBUILDMCP_AXE_PATH` |
| `iosTemplatePath` | `XCODEBUILDMCP_IOS_TEMPLATE_PATH` |
| `iosTemplateVersion` | `XCODEBUILD_MCP_IOS_TEMPLATE_VERSION` |
| `macosTemplatePath` | `XCODEBUILDMCP_MACOS_TEMPLATE_PATH` |
| `macosTemplateVersion` | `XCODEBUILD_MCP_MACOS_TEMPLATE_VERSION` |

### Session default bootstrap values

| Session default | Environment variable |
|----------------|---------------------|
| `workspacePath` | `XCODEBUILDMCP_WORKSPACE_PATH` |
| `projectPath` | `XCODEBUILDMCP_PROJECT_PATH` |
| `scheme` | `XCODEBUILDMCP_SCHEME` |
| `configuration` | `XCODEBUILDMCP_CONFIGURATION` |
| `simulatorName` | `XCODEBUILDMCP_SIMULATOR_NAME` |
| `simulatorId` | `XCODEBUILDMCP_SIMULATOR_ID` |
| `simulatorPlatform` | `XCODEBUILDMCP_SIMULATOR_PLATFORM` |
| `deviceId` | `XCODEBUILDMCP_DEVICE_ID` |
| `platform` | `XCODEBUILDMCP_PLATFORM` |
| `useLatestOS` | `XCODEBUILDMCP_USE_LATEST_OS` |
| `arch` | `XCODEBUILDMCP_ARCH` |
| `suppressWarnings` | `XCODEBUILDMCP_SUPPRESS_WARNINGS` |
| `derivedDataPath` | `XCODEBUILDMCP_DERIVED_DATA_PATH` |
| `preferXcodebuild` | `XCODEBUILDMCP_PREFER_XCODEBUILD` |
| `bundleId` | `XCODEBUILDMCP_BUNDLE_ID` |

### Example MCP config

Use this when your MCP client needs env-based bootstrap defaults:

```json
{
  "mcpServers": {
    "XcodeBuildMCP": {
      "command": "npx",
      "args": ["-y", "xcodebuildmcp@latest", "mcp"],
      "env": {
        "XCODEBUILDMCP_ENABLED_WORKFLOWS": "simulator,debugging,logging",
        "XCODEBUILDMCP_WORKSPACE_PATH": "/Users/me/MyApp/MyApp.xcworkspace",
        "XCODEBUILDMCP_SCHEME": "MyApp",
        "XCODEBUILDMCP_PLATFORM": "iOS Simulator",
        "XCODEBUILDMCP_SIMULATOR_NAME": "iPhone 16 Pro"
      }
    }
  }
}
```

You can also export a bootstrap block interactively:

```bash
xcodebuildmcp setup --format mcp-json
```

That export is intended for MCP client bootstrap. It does not replace `config.yaml` as the canonical project configuration.

---

## Related docs

- Session defaults: [SESSION_DEFAULTS.md](SESSION_DEFAULTS.md)
- Tools reference: [TOOLS.md](TOOLS.md)
- Privacy and telemetry: [PRIVACY.md](PRIVACY.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
