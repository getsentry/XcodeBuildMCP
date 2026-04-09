# Contributing

Contributions are welcome! Here's how you can help improve XcodeBuildMCP.

- [Local development setup](#local-development-setup)
  - [Prerequisites](#prerequisites)
    - [Optional: Enabling UI Automation](#optional-enabling-ui-automation)
  - [Installation](#installation)
  - [Configure your MCP client](#configure-your-mcp-client)
  - [Developing using VS Code](#developing-using-vs-code)
  - [Debugging](#debugging)
    - [MCP Inspector (Basic Debugging)](#mcp-inspector-basic-debugging)
    - [Reloaderoo (Advanced Debugging) - **RECOMMENDED**](#reloaderoo-advanced-debugging---recommended)
      - [1. Proxy Mode (Hot-Reloading)](#1-proxy-mode-hot-reloading)
      - [2. Inspection Mode (Raw MCP Debugging)](#2-inspection-mode-raw-mcp-debugging)
    - [Workflow Selection Testing](#workflow-selection-testing)
    - [Using XcodeBuildMCP doctor tool](#using-xcodebuildmcp-doctor-tool)
    - [Development Workflow with Reloaderoo](#development-workflow-with-reloaderoo)
- [Architecture and Code Standards](#architecture-and-code-standards)
  - [Code Quality Requirements](#code-quality-requirements)
  - [Testing Standards](#testing-standards)
  - [Pre-Commit Checklist](#pre-commit-checklist)
- [Making changes](#making-changes)
- [Plugin Development](#plugin-development)
  - [Quick Plugin Development Checklist](#quick-plugin-development-checklist)
  - [Working with Project Templates](#working-with-project-templates)
    - [Template Repositories](#template-repositories)
    - [Local Template Development](#local-template-development)
    - [Template Versioning](#template-versioning)
    - [Testing Template Changes](#testing-template-changes)
- [Testing](#testing)
- [Submitting](#submitting)
- [Code of Conduct](#code-of-conduct)

## Local development setup

### Prerequisites

In addition to the prerequisites mentioned in the [Getting started](README.md/#getting-started) section of the README, you will also need:

- Node.js (v18 or later)
- npm

#### Optional: Enabling UI Automation

When running locally, you'll need to install AXe for UI automation:

```bash
# Install axe (required for UI automation)
brew tap cameroncooke/axe
brew install axe
```

#### Optional: Using a Local AXe Checkout for Bundling

`npm run bundle:axe` defaults to downloading pinned AXe release artifacts from GitHub.

To bundle from a local AXe source checkout instead:

```bash
AXE_USE_LOCAL=1 AXE_LOCAL_DIR=/absolute/path/to/AXe npm run bundle:axe
```

Rules:
- Local mode is enabled only when `AXE_USE_LOCAL=1`.
- `AXE_LOCAL_DIR` must point to a valid AXe repository (must contain `Package.swift`).
- If `AXE_USE_LOCAL=1` and `AXE_LOCAL_DIR` is missing/invalid, bundling fails fast.
- `AXE_FORCE_REMOTE=1` overrides local mode and forces remote artifact download.

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Install repository-managed git hooks:
   ```
   npm run hooks:install
   ```
   This configures `core.hooksPath` to `.githooks` so the shared pre-commit hook runs for this repository.
4. Build the project:
   ```
   npm run build
   ```
5. Start the server:
   ```
   node build/cli.js mcp
   ```

### Configure your MCP client

Most MCP clients (Cursor, VS Code, Windsurf, Claude Desktop etc) have standardised on the following JSON configuration format, just add the the following to your client's JSON configuration's `mcpServers` object:

```json
{
  "mcpServers": {
    "XcodeBuildMCP": {
      "command": "node",
      "args": [
        "/path_to/XcodeBuildMCP/build/cli.js",
        "mcp"
      ]
    }
  }
}
```

### Developing using VS Code

VS Code is especially good for developing XcodeBuildMCP as it has a built-in way to view MCP client/server logs as well as the ability to configure MCP servers at a project level. It probably has the most comprehensive support for MCP development.

To make your development workflow in VS Code more efficient:

1.  **Start the MCP Server**: Open the `.vscode/mcp.json` file. You can start the `xcodebuildmcp-dev` server either by clicking the `Start` CodeLens that appears above the server definition, or by opening the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`), running `Mcp: List Servers`, selecting `xcodebuildmcp-dev`, and starting the server.
2.  **Launch the Debugger**: Press `F5` to attach the Node.js debugger.

Once these steps are completed, you can utilize the tools from the MCP server you are developing within this repository in agent mode.
For more details on how to work with MCP servers in VS Code see: https://code.visualstudio.com/docs/copilot/chat/mcp-servers

### Debugging

#### MCP Inspector (Basic Debugging)

You can use MCP Inspector for basic debugging via:

```bash
npm run inspect
```

or if you prefer the explicit command:

```bash
npx @modelcontextprotocol/inspector node build/cli.js mcp
```

#### Reloaderoo (Advanced Debugging) - **RECOMMENDED**

For development and debugging, we strongly recommend using **Reloaderoo**, which provides hot-reloading capabilities and advanced debugging features for MCP servers.

Reloaderoo operates in two modes:

##### 1. Proxy Mode (Hot-Reloading)
Provides transparent hot-reloading without disconnecting your MCP client:

```bash
# Install reloaderoo globally
npm install -g reloaderoo

# Start XcodeBuildMCP through reloaderoo proxy
reloaderoo -- node build/cli.js mcp
```

**Benefits**:
- 🔄 Hot-reload server without restarting client
- 🛠️ Automatic `restart_server` tool added to toolset
- 🌊 Transparent MCP protocol forwarding
- 📡 Full protocol support (tools, resources, prompts)

**MCP Client Configuration for Proxy Mode**:
```json
"XcodeBuildMCP": {
  "command": "reloaderoo",
  "args": ["--", "node", "/path/to/XcodeBuildMCP/build/cli.js", "mcp"],
  "env": {
    "XCODEBUILDMCP_DEBUG": "true"
  }
}
```

##### 2. Inspection Mode (Raw MCP Debugging)
Exposes debug tools for making raw MCP protocol calls and inspecting server responses:

```bash
# Start reloaderoo in inspection mode
reloaderoo inspect mcp -- node build/cli.js mcp
```

**Available Debug Tools**:
- `list_tools` - List all server tools
- `call_tool` - Execute any server tool with parameters
- `list_resources` - List all server resources
- `read_resource` - Read any server resource
- `list_prompts` - List all server prompts
- `get_prompt` - Get any server prompt
- `get_server_info` - Get comprehensive server information
- `ping` - Test server connectivity

**MCP Client Configuration for Inspection Mode**:
```json
"XcodeBuildMCP": {
  "command": "node",
  "args": [
    "/path/to/reloaderoo/dist/bin/reloaderoo.js",
    "inspect", "mcp",
    "--working-dir", "/path/to/XcodeBuildMCP",
    "--",
    "node", "/path/to/XcodeBuildMCP/build/cli.js", "mcp"
  ],
  "env": {
    "XCODEBUILDMCP_DEBUG": "true"
  }
}
```

#### Workflow Selection Testing

Test full vs. selective workflow registration during development:

```bash
# Test full tool registration (default)
reloaderoo inspect mcp -- node build/cli.js mcp

# Test selective workflow registration
XCODEBUILDMCP_ENABLED_WORKFLOWS=simulator,device reloaderoo inspect mcp -- node build/cli.js mcp
```
**Key Differences to Test**:
- **Full Registration**: All tools are available immediately via `list_tools`
- **Selective Registration**: Only tools from the selected workflows (plus `session-management`) are available

#### Using XcodeBuildMCP doctor tool

Running the XcodeBuildMCP server with the environmental variable `XCODEBUILDMCP_DEBUG=true` will expose a new doctor MCP tool called `doctor` which your agent can call to get information about the server's environment, available tools, and configuration status.

> [!NOTE]
> You can also call the doctor tool directly using the following command but be advised that the output may vary from that of the MCP tool call due to environmental differences:
> ```bash
> npm run doctor
> ```

#### Development Workflow with Reloaderoo

1. **Start Development Session**:
   ```bash
   # Terminal 1: Start in hot-reload mode
   reloaderoo -- node build/cli.js mcp

   # Terminal 2: Start build watcher
   npm run build:watch
   ```

2. **Make Changes**: Edit source code in `src/`

3. **Test Changes**: Ask your AI client to restart the server:
   ```
   "Please restart the MCP server to load my changes"
   ```
   The AI will automatically call the `restart_server` tool provided by reloaderoo.

4. **Verify Changes**: New functionality immediately available without reconnecting client

## Architecture and Code Standards

Before making changes, please familiarize yourself with:
- [ARCHITECTURE.md](ARCHITECTURE.md) - Comprehensive architectural overview
- [CLAUDE.md](../../CLAUDE.md) - AI assistant guidelines and testing principles
- [TOOLS.md](../TOOLS.md) - Complete tool documentation
- [CONFIGURATION.md](../CONFIGURATION.md) - Tool configuration options

### Code Quality Requirements

1. **Follow existing code patterns and structure**
2. **Use TypeScript strictly** - no `any` types, proper typing throughout
3. **Add proper error handling and logging** - all failures must set `isError: true`
4. **Update documentation for new features**
5. **Test with example projects before submitting**

### Testing Standards

All contributions must adhere to the testing standards outlined in the [**XcodeBuildMCP Plugin Testing Guidelines (TESTING.md)**](TESTING.md). This is the canonical source of truth for all testing practices.

**Key Principles (Summary):**
- **Dependency Injection for Complex Processes**: MCP tool logic functions that orchestrate complex, long-running processes with sub-processes (e.g., `xcodebuild`) must use injected `CommandExecutor` and `FileSystemExecutor` patterns. Standalone utility modules with simple commands may use direct imports and standard vitest mocking.
- **Internal Mocking Is Allowed**: Vitest mocking (`vi.mock`, `vi.fn`, `vi.spyOn`, etc.) is acceptable for internal modules/collaborators.
- **Test Production Code**: Tests must import and execute the actual tool logic, not mock implementations.
- **Comprehensive Coverage**: Tests must cover input validation, command generation, and output processing.

Please read [TESTING.md](TESTING.md) in its entirety before writing tests.

### Pre-Commit Checklist

**MANDATORY**: Run these commands before any commit and ensure they all pass:

```bash
# 1. Run linting (must pass with 0 errors)
npm run lint:fix

# 2. Run typechecker (must pass with 0 errors)
npm run typecheck

# 3. Run formatting (must format all files)
npm run format

# 4. Run build (must compile successfully)
npm run build

# 5. Validate docs CLI command references (requires built CLI artifact)
npm run docs:check

# 6. Run tests (all tests must pass)
npm test
```

**NO EXCEPTIONS**: Code that fails any of these commands cannot be committed.

The shared pre-commit hook installed via `npm run hooks:install` runs:
- `npm run format:check`
- `npm run lint`
- `npm run build`
- `npm run docs:check`

## Making changes

1. Fork the repository and create a new branch
2. Follow the TypeScript best practices and existing code style
3. Add proper parameter validation and error handling

## Plugin Development

For comprehensive instructions on creating new tools and workflow groups, see our dedicated [Plugin Development Guide](PLUGIN_DEVELOPMENT.md).

The plugin development guide covers:
- Auto-discovery system architecture
- Tool creation with dependency injection patterns
- Workflow group organization
- Testing guidelines and patterns
- Workflow registration and selection

### Quick Plugin Development Checklist

1. Choose appropriate workflow directory in `src/mcp/tools/`
2. Follow naming conventions: `{action}_{target}_{specifier}_{projectType}`
3. Use dependency injection pattern with separate logic functions
4. Create comprehensive tests using `createMockExecutor()`
5. Add workflow metadata if creating new workflow group

See [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md) for complete details.

### Working with Project Templates

XcodeBuildMCP uses external template repositories for the iOS and macOS project scaffolding features. These templates are maintained separately to allow independent versioning and updates.

#### Template Repositories

- **iOS Template**: [XcodeBuildMCP-iOS-Template](https://github.com/getsentry/XcodeBuildMCP-iOS-Template)
- **macOS Template**: [XcodeBuildMCP-macOS-Template](https://github.com/getsentry/XcodeBuildMCP-macOS-Template)

#### Local Template Development

When developing or testing changes to the templates:

1. Clone the template repository you want to work on:
   ```bash
   git clone https://github.com/getsentry/XcodeBuildMCP-iOS-Template.git
   git clone https://github.com/getsentry/XcodeBuildMCP-macOS-Template.git
   ```

2. Set the appropriate environment variable to use your local template:
   ```bash
   # For iOS template development
   export XCODEBUILDMCP_IOS_TEMPLATE_PATH=/path/to/XcodeBuildMCP-iOS-Template

   # For macOS template development
   export XCODEBUILDMCP_MACOS_TEMPLATE_PATH=/path/to/XcodeBuildMCP-macOS-Template
   ```

3. When using MCP clients, add these environment variables to your MCP configuration:
```json
"XcodeBuildMCP": {
  "command": "node",
  "args": ["/path_to/XcodeBuildMCP/build/cli.js", "mcp"],
  "env": {
    "XCODEBUILDMCP_IOS_TEMPLATE_PATH": "/path/to/XcodeBuildMCP-iOS-Template",
    "XCODEBUILDMCP_MACOS_TEMPLATE_PATH": "/path/to/XcodeBuildMCP-macOS-Template"
  }
}
```

4. The scaffold tools will use your local templates instead of downloading from GitHub releases.

#### Template Versioning

- Templates are versioned independently from XcodeBuildMCP
- The default template version is specified in `package.json` under `templateVersion`
- You can override the template version with `XCODEBUILD_MCP_TEMPLATE_VERSION` environment variable
- To update the default template version:
  1. Update `templateVersion` in `package.json`
  2. Run `npm run build` to regenerate version.ts
  3. Create a new XcodeBuildMCP release

#### Testing Template Changes

1. Make changes to your local template
2. Test scaffolding with your changes using the local override
3. Verify the scaffolded project builds and runs correctly
4. Once satisfied, create a PR in the template repository
5. After merging, create a new release in the template repository using the release script

## Testing

1. Build the project with `npm run build`
2. Test your changes with MCP Inspector
3. Verify tools work correctly with different MCP clients

## Submitting

1. Run `npm run lint` to check for linting issues (use `npm run lint:fix` to auto-fix)
2. Run `npm run format:check` to verify formatting (use `npm run format` to fix)
3. Update documentation if you've added or modified features
4. Add your changes to the CHANGELOG.md file
5. Push your changes and create a pull request with a clear description
6. Link any related issues

For major changes or new features, please open an issue first to discuss your proposed changes.

## Code of Conduct

Please follow our [Code of Conduct](../../CODE_OF_CONDUCT.md) and community guidelines.
