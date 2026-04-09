# XcodeBuildMCP CLI

`xcodebuildmcp` is a unified command-line interface that provides both an MCP server and direct tool access via a first-class CLI.

Use `xcodebuildmcp` CLI to invoke tools or start the MCP server by passing the `mcp` argument.

## Installation

```bash
# Install globally
npm install -g xcodebuildmcp@beta

# Or run via npx
npx xcodebuildmcp@beta --help
```

## Quick Start

```bash
# List available tools
xcodebuildmcp tools

# View CLI help
xcodebuildmcp --help

# View tool help
xcodebuildmcp <workflow> <tool> --help

# Run interactive setup for .xcodebuildmcp/config.yaml
xcodebuildmcp setup
```

## Tool Options

Each tool supports `--help` for detailed options:

```bash
xcodebuildmcp simulator build --help
```

Common patterns:

```bash
# Pass options as flags
xcodebuildmcp simulator build --scheme MyApp --project-path ./MyApp.xcodeproj

# Pass complex options as JSON
xcodebuildmcp simulator build --json '{"scheme": "MyApp", "projectPath": "./MyApp.xcodeproj"}'

# Control output format
xcodebuildmcp simulator list --output json
```

## Examples

### Build and Run Workflow

```bash
# Discover projects
xcodebuildmcp simulator discover-projects

# List schemes
xcodebuildmcp simulator list-schemes --project-path ./MyApp.xcodeproj

# Build
xcodebuildmcp simulator build --scheme MyApp --project-path ./MyApp.xcodeproj

# Boot simulator
xcodebuildmcp simulator boot --simulator-name "iPhone 17 Pro"

# Install and launch
xcodebuildmcp simulator install --simulator-id <UDID> --app-path ./build/MyApp.app

xcodebuildmcp simulator launch-app --simulator-id <UDID> --bundle-id io.sentry.MyApp

# Or... build and run in a single command
xcodebuildmcp simulator build-and-run --scheme MyApp --project-path ./MyApp.xcodeproj
```

### Testing

```bash
# Run all tests
xcodebuildmcp simulator test --scheme MyAppTests --project-path ./MyApp.xcodeproj

# Run with specific simulator
xcodebuildmcp simulator test --scheme MyAppTests --simulator-name "iPhone 17 Pro"
```

For a full list of workflows and tools, see [TOOLS-CLI.md](TOOLS-CLI.md).

## Configuration

The CLI respects the same configuration as the MCP server:

```yaml
# .xcodebuildmcp/config.yaml
sessionDefaults:
  scheme: MyApp
  projectPath: ./MyApp.xcodeproj
  simulatorName: iPhone 17 Pro

enabledWorkflows:
  - simulator
  - project-discovery
```

See [CONFIGURATION.md](CONFIGURATION.md) for the full schema.

To create/update config interactively, run `xcodebuildmcp setup`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XCODEBUILDMCP_SOCKET` | Override socket path for all commands |
| `XCODEBUILDMCP_DAEMON_IDLE_TIMEOUT_MS` | Daemon idle timeout in ms (default `600000`, set `0` to disable) |
| `XCODEBUILDMCP_DISABLE_SESSION_DEFAULTS` | Disable session defaults |

## CLI vs MCP Mode

| Feature | CLI (`xcodebuildmcp <tool>`) | MCP (`xcodebuildmcp mcp`) |
|---------|------------------------------|---------------------------|
| Invocation | Direct terminal | MCP client (Claude, etc.) |
| Session state | Stateless direct + daemon for stateful tools | In-process |
| Use case | Scripts, CI, manual | AI-assisted development |
| Configuration | Same config.yaml | Same config.yaml |

Both share the same underlying tool implementations.

## Per-Workspace Daemon

The CLI uses a per-workspace daemon architecture only when needed:

- Stateless tools run directly in the CLI process.
- Stateful tools route through the daemon (auto-started as needed).
- Dynamic `xcode-ide` bridge tools are a special-case daemon-backed path for persistent bridge sessions.

### How It Works

- **Workspace identity**: The workspace root is determined by the location of `.xcodebuildmcp/config.yaml`, or falls back to the current directory.
- **Socket location**: Each daemon runs on a Unix socket at `~/.xcodebuildmcp/daemons/<workspace-key>/daemon.sock`
- **Auto-start**: The daemon starts automatically when you invoke a stateful tool - no manual setup required.
- **Auto-shutdown**: The daemon exits after 10 minutes of inactivity, but only when there are no active stateful sessions (log capture, debugging, video capture, background swift-package processes).

### Daemon Commands

```bash
# Check daemon status for current workspace
xcodebuildmcp daemon status

# Manually start the daemon
xcodebuildmcp daemon start

# Stop the daemon
xcodebuildmcp daemon stop

# Restart the daemon
xcodebuildmcp daemon restart

# List all daemons across workspaces
xcodebuildmcp daemon list

# List in JSON format
xcodebuildmcp daemon list --json
```

### Daemon Status Output

```
Daemon Status: Running
  PID: 12345
  Workspace: /Users/you/Projects/MyApp
  Socket: /Users/you/.xcodebuildmcp/daemons/c5da0cbe19a7/daemon.sock
  Started: 2024-01-15T10:30:00.000Z
  Tools: 94
  Workflows: (default)
```

### Daemon List Output

```
Daemons:

  [running] c5da0cbe19a7
    Workspace: /Users/you/Projects/MyApp
    PID: 12345
    Started: 2024-01-15T10:30:00.000Z
    Version: 1.15.0

  [stale] a1b2c3d4e5f6
    Workspace: /Users/you/Projects/OldProject
    PID: 99999
    Started: 2024-01-14T08:00:00.000Z
    Version: 1.14.0

Total: 2 (1 running, 1 stale)
```

## Stateful vs Stateless Tools

### Stateless Tools (run in-process)
Most tools run directly without the daemon:
- `build`, `test`, `clean`
- `list`, `list-schemes`, `discover-projects`
- `boot`, `install`, `launch-app` etc.

### Stateful Tools (require daemon)
Some tools maintain state and route through the daemon:
- Video recording: `record-video`
- Debugging: `attach`, `continue`, etc.
- Background processes: `run`, `stop`

When you invoke a stateful tool, the daemon auto-starts if needed.

## Global Options

| Option | Description |
|--------|-------------|
| `--socket <path>` | Override the daemon socket path (hidden) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Troubleshooting

### Daemon won't start

```bash
# Check for stale sockets
xcodebuildmcp daemon list

# Force restart
xcodebuildmcp daemon restart

# Run in foreground to see logs
xcodebuildmcp daemon start --foreground
```

### Tool timeout

Increase the daemon startup timeout:

```bash
# Default is 5 seconds
export XCODEBUILDMCP_STARTUP_TIMEOUT_MS=10000
```

### Socket permission errors

The socket directory (`~/.xcodebuildmcp/daemons/`) should have mode 0700. If you encounter permission issues:

```bash
chmod 700 ~/.xcodebuildmcp
chmod -R 700 ~/.xcodebuildmcp/daemons
```
