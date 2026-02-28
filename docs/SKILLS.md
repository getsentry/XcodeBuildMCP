# XcodeBuildMCP Skill

XcodeBuildMCP includes two optional agent skills:

- **MCP Skill**: Primes the agent with instructions on how to use the MCP server's tools (optional when using the MCP server).

- **CLI Skill**: Primes the agent with instructions on how to navigate the CLI (recommended when using the CLI).

## Install

```bash
xcodebuildmcp init
```

This auto-detects installed AI clients (Claude Code, Cursor, Codex) and installs the CLI skill.

### Options

```bash
xcodebuildmcp init --skill cli          # Install CLI skill (default)
xcodebuildmcp init --skill mcp          # Install MCP skill
xcodebuildmcp init --client claude      # Install to Claude only
xcodebuildmcp init --dest /path/to/dir  # Install to custom directory
xcodebuildmcp init --force              # Overwrite existing
xcodebuildmcp init --remove-conflict    # Auto-remove conflicting variant
xcodebuildmcp init --uninstall          # Remove installed skill
```

When installing `--skill mcp` in auto-detect mode, Claude Code targets are skipped because Claude already receives MCP guidance through server instructions. If you explicitly set `--client claude`, MCP skill installation is still allowed.

## Unsupported Clients

For clients without a skills directory, print the skill content and pipe it to a file or paste it into your client's instructions area:

```bash
xcodebuildmcp init --print
xcodebuildmcp init --print --skill mcp > my-skill.md
```

## Skills

To learn more about skills see: [https://agentskills.io/home](https://agentskills.io/home).
