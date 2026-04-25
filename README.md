<img src="assets/banner.png" alt="XcodeBuild MCP" width="600"/>

A Model Context Protocol (MCP) server and CLI that provides tools for agent use when working on iOS and macOS projects.

[![CI](https://github.com/getsentry/XcodeBuildMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/getsentry/XcodeBuildMCP/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/xcodebuildmcp.svg)](https://badge.fury.io/js/xcodebuildmcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node->=18.x-brightgreen.svg)](https://nodejs.org/) [![Xcode 16](https://img.shields.io/badge/Xcode-16-blue.svg)](https://developer.apple.com/xcode/) [![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/) [![MCP](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/getsentry/XcodeBuildMCP) [![AgentAudit Security](https://img.shields.io/badge/AgentAudit-Safe-brightgreen?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAxTDMgNXY2YzAgNS41NSAzLjg0IDEwLjc0IDkgMTIgNS4xNi0xLjI2IDktNi40NSA5LTEyVjVsLTktNHoiLz48L3N2Zz4=)](https://www.agentaudit.dev/skills/xcodebuildmcp)

## Installation

XcodeBuildMCP ships as a single package with two modes: a **CLI** for direct terminal use and an **MCP server** for AI coding agents. Either install method gives you both.

### Option A — Homebrew

```bash
brew tap getsentry/xcodebuildmcp
brew install xcodebuildmcp
```

### Option B — npm (Node.js 18+)

```bash
npm install -g xcodebuildmcp@latest
```

Verify either install:
```bash
xcodebuildmcp --help
```

### Connect your MCP client

Drop-in config snippets for Cursor, Claude Code, Codex, can be found in the official docs page [MCP Clients](https://xcodebuildmcp.com/docs/clients). Most clients can also run the MCP server on demand via `npx -y xcodebuildmcp@latest mcp` without a global install.

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

For further information on installing skills, see [Agent Skills](https://xcodebuildmcp.com/docs/skills).

## Notes

- XcodeBuildMCP requests xcodebuild to skip macro validation to avoid errors when building projects that use Swift Macros.
- Device tools require code signing to be configured in Xcode. See [Device Code Signing](https://xcodebuildmcp.com/docs/device-signing).

## Privacy

XcodeBuildMCP uses Sentry for internal runtime error telemetry only. For details and opt-out instructions, see [Privacy & Telemetry](https://xcodebuildmcp.com/docs/privacy).

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

Check for updates and upgrade in place:

```bash
xcodebuildmcp upgrade --check
xcodebuildmcp upgrade --yes
```

The CLI uses a per-workspace daemon for stateful operations (log capture, debugging, etc.) that auto-starts when needed. See the [CLI guide](https://xcodebuildmcp.com/docs/cli) for full documentation.

## Documentation

- Installation: [https://xcodebuildmcp.com/docs/installation](https://xcodebuildmcp.com/docs/installation)
- Setup: [https://xcodebuildmcp.com/docs/setup](https://xcodebuildmcp.com/docs/setup)
- MCP clients: [https://xcodebuildmcp.com/docs/clients](https://xcodebuildmcp.com/docs/clients)
- CLI usage: [https://xcodebuildmcp.com/docs/cli](https://xcodebuildmcp.com/docs/cli)
- Configuration and options: [https://xcodebuildmcp.com/docs/configuration](https://xcodebuildmcp.com/docs/configuration)
- Tools reference: [https://xcodebuildmcp.com/docs/tools](https://xcodebuildmcp.com/docs/tools)
- Troubleshooting: [https://xcodebuildmcp.com/docs/troubleshooting](https://xcodebuildmcp.com/docs/troubleshooting)
- Privacy: [https://xcodebuildmcp.com/docs/privacy](https://xcodebuildmcp.com/docs/privacy)
- Skills: [https://xcodebuildmcp.com/docs/skills](https://xcodebuildmcp.com/docs/skills)
- Contributing: [https://xcodebuildmcp.com/docs/contributing](https://xcodebuildmcp.com/docs/contributing)

## Licence

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
For third-party licensing notices see the [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) file for details.
For npm package attributions see the [THIRD_PARTY_PACKAGE_LICENSES](THIRD_PARTY_PACKAGE_LICENSES.md) file for details.
