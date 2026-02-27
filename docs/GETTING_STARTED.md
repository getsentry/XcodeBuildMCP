# Getting Started

## Prerequisites
- macOS 14.5 or later
- Xcode 16.x or later
- Node.js 18.x or later (not required for Homebrew installation)

## Choose Your Interface

XcodeBuildMCP provides a unified CLI with two modes:

| Command | Use Case |
|---------|----------|
| `xcodebuildmcp mcp` | Start MCP server for AI-assisted development |
| `xcodebuildmcp <workflow> <tool>` | Direct terminal usage, scripts, CI pipelines |

Both share the same tools and configuration.

## Installation

Both methods give you the CLI and the MCP server.

### Option A — Homebrew (no Node.js required)

```bash
brew tap getsentry/xcodebuildmcp
brew install xcodebuildmcp
```

Use the CLI:
```bash
xcodebuildmcp --help
```

MCP client config:
```json
"XcodeBuildMCP": {
  "command": "xcodebuildmcp",
  "args": ["mcp"]
}
```

Upgrade later with `brew update && brew upgrade xcodebuildmcp`.

### Option B — npm / npx (Node.js 18+)

**For CLI use**, install globally:
```bash
npm install -g xcodebuildmcp@latest
xcodebuildmcp --help
```

**For MCP server only**, no global install needed — add directly to your client config:
```json
"XcodeBuildMCP": {
  "command": "npx",
  "args": ["-y", "xcodebuildmcp@latest", "mcp"]
}
```

Using `@latest` ensures clients resolve the newest version on each run.

See [CLI.md](CLI.md) for full CLI documentation.

## Project config (optional)
For deterministic session defaults and runtime configuration, add a config file at:

```text
<workspace-root>/.xcodebuildmcp/config.yaml
```

Use the setup wizard to create or update this file interactively:

```bash
xcodebuildmcp setup
```

See [CONFIGURATION.md](CONFIGURATION.md) for the full schema and examples.

## Client-specific configuration

The examples below use npx (Option B). If you installed via Homebrew, replace the command with `"command": "xcodebuildmcp", "args": ["mcp"]` instead.

### Cursor
Recommended (project-scoped): create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "XcodeBuildMCP": {
      "command": "npx",
      "args": ["-y", "xcodebuildmcp@latest", "mcp"]
    }
  }
}
```

If you use a global Cursor config at `~/.cursor/mcp.json`, use this variant to align startup with the active workspace:

```json
{
  "mcpServers": {
    "XcodeBuildMCP": {
      "command": "/bin/zsh",
      "args": [
        "-lc",
        "cd \"${workspaceFolder}\" && exec npx -y xcodebuildmcp@latest mcp"
      ]
    }
  }
}
```

### OpenAI Codex CLI
Codex uses TOML for MCP configuration. Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.XcodeBuildMCP]
command = "npx"
args = ["-y", "xcodebuildmcp@latest", "mcp"]
env = { "XCODEBUILDMCP_SENTRY_DISABLED" = "false" }
```

If you see tool calls timing out (for example, `timed out awaiting tools/call after 60s`), increase the timeout:

```toml
tool_timeout_sec = 600
```

For more info see the OpenAI Codex configuration docs:
https://github.com/openai/codex/blob/main/docs/config.md#connecting-to-mcp-servers

### Claude Code CLI
```bash
# Add XcodeBuildMCP server to Claude Code
claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest mcp

# Or with environment variables
claude mcp add XcodeBuildMCP -e XCODEBUILDMCP_SENTRY_DISABLED=false -- npx -y xcodebuildmcp@latest mcp
```

Note: XcodeBuildMCP requests xcodebuild to skip macro validation to avoid Swift Macro build errors.

## Next steps
- Configuration options: [CONFIGURATION.md](CONFIGURATION.md)
- Session defaults and opt-out: [SESSION_DEFAULTS.md](SESSION_DEFAULTS.md)
- Tools reference: [TOOLS.md](TOOLS.md)
- CLI guide: [CLI.md](CLI.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
