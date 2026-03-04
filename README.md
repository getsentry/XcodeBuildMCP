<img src="banner.png" alt="XcodeBuild MCP" width="600"/>

A Model Context Protocol (MCP) server and CLI that provides tools for agent use when working on iOS and macOS projects.

[![CI](https://github.com/getsentry/XcodeBuildMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/getsentry/XcodeBuildMCP/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/xcodebuildmcp.svg)](https://badge.fury.io/js/xcodebuildmcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node->=18.x-brightgreen.svg)](https://nodejs.org/) [![Xcode 16](https://img.shields.io/badge/Xcode-16-blue.svg)](https://developer.apple.com/xcode/) [![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/) [![MCP](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/getsentry/XcodeBuildMCP) [![AgentAudit Security](https://img.shields.io/badge/AgentAudit-Safe-brightgreen?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAxTDMgNXY2YzAgNS41NSAzLjg0IDEwLjc0IDkgMTIgNS4xNi0xLjI2IDktNi40NSA5LTEyVjVsLTktNHoiLz48L3N2Zz4=)](https://www.agentaudit.dev/skills/xcodebuildmcp)

## Installation

XcodeBuildMCP ships as a single package with two modes: a **CLI** for direct terminal use and an **MCP server** for AI coding agents. Both installation methods give you both modes.

### Option A — Homebrew

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

To pin a specific version, replace `@latest` with an exact version (e.g. `xcodebuildmcp@latest`).

### Client-specific setup

The examples below use npx (Option B). If you installed via Homebrew, replace the command with `"command": "xcodebuildmcp", "args": ["mcp"]` instead.

<details>
  <summary>Cursor</summary>
  <br />

  Recommended (project-scoped): add `.cursor/mcp.json` in your workspace root:
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

  For global Cursor config (`~/.cursor/mcp.json`), use this variant so startup is aligned with the active workspace:
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

  Or use the quick install link:

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-light.svg)](https://cursor.com/en-US/install-mcp?name=XcodeBuildMCP&config=eyJjb21tYW5kIjoibnB4IC15IHhjb2RlYnVpbGRtY3BAbGF0ZXN0IG1jcCJ9)
  <br />
</details>

<details>
  <summary>Claude Code</summary>
  <br />

  Run:
  ```bash
  claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest mcp
  ```
  <br />
</details>

<details>
  <summary>Codex CLI</summary>
  <br />

  Run:
  ```bash
  codex mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest mcp
  ```

  Or add to `~/.codex/config.toml`:
  ```toml
  [mcp_servers.XcodeBuildMCP]
  command = "npx"
  args = ["-y", "xcodebuildmcp@latest", "mcp"]
  ```
  <br />
</details>

<details>
  <summary>Claude Desktop</summary>
  <br />

  Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
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
  <br />
</details>

<details>
  <summary>VS Code / VS Code Insiders</summary>
  <br />

  Add to your VS Code settings JSON:
  ```json
  "mcp": {
    "servers": {
      "XcodeBuildMCP": {
        "command": "npx",
        "args": ["-y", "xcodebuildmcp@latest", "mcp"]
      }
    }
  }
  ```

  Or use the quick install links:

  [![Install in VS Code](https://img.shields.io/badge/VS_Code-XcodeBuildMCP-0098FF?style=flat&logo=visualstudiocode&logoColor=ffffff)](vscode:mcp/install?%7B%22name%22%3A%22XcodeBuildMCP%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22xcodebuildmcp%40latest%22%2C%22mcp%22%5D%7D)
  [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-XcodeBuildMCP-24bfa5?style=flat&logo=visualstudiocode&logoColor=ffffff)](vscode-insiders:mcp/install?%7B%22name%22%3A%22XcodeBuildMCP%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22xcodebuildmcp%40latest%22%2C%22mcp%22%5D%7D)
  <br />
</details>

<details>
  <summary>Kiro / Kiro CLI</summary>
  <br />

  **Workspace-level** (applies only to the current workspace): add `.kiro/settings/mcp.json` in your project root:
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

  **User-level** (applies globally across all workspaces): add to `~/.kiro/settings/mcp.json`:
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
  <br />
</details>

<details>
  <summary>Windsurf</summary>
  <br />

  Add to `~/.codeium/windsurf/mcp_config.json`:
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
  <br />
</details>

<details>
  <summary>Trae</summary>
  <br />

  Add to `~/Library/Application Support/Trae/User/mcp.json`:
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
  <br />
</details>

<details>
  <summary>Xcode (Codex Agent)</summary>
  <br />

  Requires Xcode 26.3 or later. Codex agent must be installed and configured in Xcode Settings -> Intelligence -> Open AI.

  The only way at the time of writing to add an MCP server is to use a project scoped `.codex/config.toml` file in the root of your project workspace:
  `/path/to/your/project/.codex/config.toml`

  ```toml
  [mcp_servers.XcodeBuildMCP]
  args = [
  "-lc",
  "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"; nvm use --silent >/dev/null 2>&1 || true; npx -y xcodebuildmcp@latest mcp"
  ]
  command = "/bin/zsh"
  enabled = true
  tool_timeout_sec = 10000
  ```

  > **NOTE**:
  > Codex Agent when running in Xcode has a limited PATH by default. The above example should work for most users but if you find the server doesn't start or is not available, it's likely because npx is not found so you might have to adjust the above configuration accordingly.

  <br />
</details>

<details>
  <summary>Xcode (Claude Code Agent)</summary>
  <br />

  Requires Xcode 26.3 or later. Claude Code agent must be installed and configured in Xcode Settings -> Intelligence -> Anthropic.

  Add to the end or replace the existing `mcpServers` object in Xcode's Claude Code agent config at:
  `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/.claude.json`

  ```json
    // ... rest of file ...
    "mcpServers": {
      "XcodeBuildMCP": {
        "command": "/bin/zsh",
        "args": [
          "-lc",
          "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; export NVM_DIR=\"$HOME/.nvm\"; [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"; nvm use --silent >/dev/null 2>&1 || true; npx -y xcodebuildmcp@latest mcp"
        ]
      }
    }
  }
  ```

  > **NOTE**:
  > Claude Code Agent when running in Xcode has a limited PATH by default. The above example should work for most users but if you find the server doesn't start or is not available, it's likely because npx is not found so you might have to adjust the above configuration accordingly.

  <br />
</details>

<details>
  <summary>AdaL CLI</summary>
  <br />

  Run the following command inside the AdaL CLI prompt:
  ```console
  /mcp add XcodeBuildMCP --command npx --args "-y,xcodebuildmcp@latest,mcp"
  ```
  <br />
</details>

<br />

For other installation options see [Getting Started](docs/GETTING_STARTED.md).

## Requirements

- macOS 14.5 or later
- Xcode 16.x or later
- Node.js 18.x or later (not required for Homebrew installation)

## Skills

XcodeBuildMCP now includes two optional agent skills:

- **MCP Skill**: Primes the agent with instructions on how to use the MCP server's tools (optional when using the MCP server).

- **CLI Skill**: Primes the agent with instructions on how to navigate the CLI (recommended when using the CLI).


To install with a global binary:

```bash
xcodebuildmcp init
```

Or install directly via npx without a global install:

```bash
npx -y xcodebuildmcp@latest init
```

For further information on installing skills, see: [docs/SKILLS.md](docs/SKILLS.md)

## Notes

- XcodeBuildMCP requests xcodebuild to skip macro validation to avoid errors when building projects that use Swift Macros.
- Device tools require code signing to be configured in Xcode. See [docs/DEVICE_CODE_SIGNING.md](docs/DEVICE_CODE_SIGNING.md).

## Privacy

XcodeBuildMCP uses Sentry for internal runtime error telemetry only. For details and opt-out instructions, see [docs/PRIVACY.md](docs/PRIVACY.md).

## CLI

XcodeBuildMCP provides a unified command-line interface. The `mcp` subcommand starts the MCP server, while all other commands provide direct terminal access to tools:

```bash
# Install globally
npm install -g xcodebuildmcp@latest

# Start the MCP server (for MCP clients)
xcodebuildmcp mcp

# List available tools
xcodebuildmcp tools

# Build for simulator
xcodebuildmcp simulator build --scheme MyApp --project-path ./MyApp.xcodeproj
```

The CLI uses a per-workspace daemon for stateful operations (log capture, debugging, etc.) that auto-starts when needed. See [docs/CLI.md](docs/CLI.md) for full documentation.

## Documentation

- Getting started: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)
- CLI usage: [docs/CLI.md](docs/CLI.md)
- Configuration and options: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- Tools reference: [docs/TOOLS.md](docs/TOOLS.md)
- Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- Privacy: [docs/PRIVACY.md](docs/PRIVACY.md)
- Skills: [docs/SKILLS.md](docs/SKILLS.md)
- Contributing: [docs/dev/CONTRIBUTING.md](docs/dev/CONTRIBUTING.md)

## Licence

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
Third-party licensing notices (including AXe and Meta's IDB MIT attributions) are in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
Generated production npm package attributions are in [THIRD_PARTY_PACKAGE_LICENSES](THIRD_PARTY_PACKAGE_LICENSES.md) (refresh with `npm run license:report`).
