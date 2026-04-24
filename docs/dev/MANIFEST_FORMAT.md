# Manifest Format Reference

This document describes the YAML manifest format used to define tools and workflows in XcodeBuildMCP. Manifests are the single source of truth for tool/workflow metadata, visibility rules, and runtime behavior.

## Overview

Manifests are stored in the `manifests/` directory:

```
manifests/
├── tools/           # Tool manifest files
│   ├── build_sim.yaml
│   ├── list_sims.yaml
│   └── ...
├── workflows/       # Workflow manifest files
│   ├── simulator.yaml
│   ├── device.yaml
│   └── ...
└── resources/       # Resource manifest files
    ├── simulators.yaml
    ├── devices.yaml
    └── ...
```

Each tool and workflow has its own YAML file. The manifest loader reads all files at startup and validates them against the schema.

## Directory Structure

Tool implementations live in `src/mcp/tools/<category>/`:

```
src/mcp/tools/
├── simulator/
│   ├── build_sim.ts        # Tool implementation
│   ├── build_run_sim.ts
│   ├── list_sims.ts
│   └── ...
├── device/
│   ├── build_device.ts
│   └── ...
└── ...
```

## Tool Manifest Format

Tool manifests define individual tools and their metadata.

### Schema

```yaml
# Required fields
id: string              # Unique tool identifier (must match filename without .yaml)
module: string          # Module path (see Module Path section)
names:
  mcp: string           # MCP tool name (globally unique, used in MCP protocol)
  cli: string           # CLI command name (optional, derived from mcp if omitted)

# Optional fields
description: string     # Tool description (shown in tool listings)
availability:           # Per-runtime availability flags
  mcp: boolean          # Available via MCP server (default: true)
  cli: boolean          # Available via CLI (default: true)
predicates: string[]    # Predicate names for visibility filtering (default: [])
routing:                # CLI daemon routing
  stateful: boolean     # Tool maintains state (default: false)
outputSchema:           # MCP structured output schema advertised to clients
  schema: string        # Schema name, e.g. xcodebuildmcp.output.build-result
  version: string       # Schema version, e.g. "1"
annotations:            # MCP tool annotations (hints for clients)
  title: string         # Human-readable title (optional)
  readOnlyHint: boolean # Tool only reads data (optional)
  destructiveHint: boolean # Tool may modify/delete data (optional)
  idempotentHint: boolean  # Safe to retry (optional)
  openWorldHint: boolean   # May access external resources (optional)
```

### Example: Basic Tool

```yaml
id: list_sims
module: mcp/tools/simulator/list_sims
names:
  mcp: list_sims
description: "List available iOS simulators."
outputSchema:
  schema: xcodebuildmcp.output.simulator-list
  version: "1"
availability:
  mcp: true
  cli: true
predicates: []
annotations:
  title: "List Simulators"
  readOnlyHint: true
```

### Example: Tool with Predicates

```yaml
id: build_sim
module: mcp/tools/simulator/build_sim
names:
  mcp: build_sim
description: "Build for iOS sim."
availability:
  mcp: true
  cli: true
predicates:
  - hideWhenXcodeAgentMode  # Hidden when Xcode provides equivalent tool
```

### Example: MCP-Only Tool

```yaml
id: manage_workflows
module: mcp/tools/workflow-discovery/manage_workflows
names:
  mcp: manage-workflows     # Note: MCP name uses hyphens
description: "Manage enabled workflows at runtime."
availability:
  mcp: true
  cli: false                # Not available in CLI
predicates:
  - experimentalWorkflowDiscoveryEnabled
```

## Workflow Manifest Format

Workflow manifests define groups of related tools.

### Schema

```yaml
# Required fields
id: string              # Unique workflow identifier (must match filename without .yaml)
title: string           # Display title
description: string     # Workflow description
tools: string[]         # Array of tool IDs belonging to this workflow

# Optional fields
availability:           # Per-runtime availability flags
  mcp: boolean          # Available via MCP server (default: true)
  cli: boolean          # Available via CLI (default: true)
selection:              # MCP selection rules
  mcp:
    defaultEnabled: boolean  # Enabled when config.enabledWorkflows is empty (default: false)
    autoInclude: boolean  # Include when predicates pass, even if not requested (default: false)
predicates: string[]    # Predicate names for visibility filtering (default: [])
```

### Example: Default-Enabled Workflow

```yaml
id: simulator
title: "iOS Simulator Development"
description: "Complete iOS development workflow for simulators."
availability:
  mcp: true
  cli: true
selection:
  mcp:
    defaultEnabled: true   # Enabled by default
    autoInclude: false
predicates: []
tools:
  - list_sims
  - boot_sim
  - build_sim
  - build_run_sim
  - test_sim
  # ... more tools
```

### Example: Auto-Include Workflow

```yaml
id: doctor
title: "MCP Doctor"
description: "Diagnostic tool for the MCP server environment."
availability:
  mcp: true
  cli: true
selection:
  mcp:
    defaultEnabled: false
    autoInclude: true      # Auto-included when predicates pass
predicates:
  - debugEnabled           # Only shown in debug mode
tools:
  - doctor
```

### Example: Conditional Workflow

```yaml
id: workflow-discovery
title: "Workflow Discovery"
description: "Manage enabled workflows at runtime."
availability:
  mcp: true
  cli: false
selection:
  mcp:
    defaultEnabled: false
    autoInclude: true
predicates:
  - experimentalWorkflowDiscoveryEnabled  # Feature flag
tools:
  - manage_workflows
```

## Field Reference

### Tool Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | - | Unique identifier, must match filename |
| `module` | string | Yes | - | Module path relative to `src/` (extensionless) |
| `names.mcp` | string | Yes | - | MCP protocol tool name |
| `names.cli` | string | No | Derived from MCP name | CLI command name |
| `description` | string | No | - | Tool description |
| `availability.mcp` | boolean | No | `true` | Available via MCP |
| `availability.cli` | boolean | No | `true` | Available via CLI |
| `predicates` | string[] | No | `[]` | Visibility predicates (all must pass) |
| `routing.stateful` | boolean | No | `false` | Tool maintains state |
| `outputSchema.schema` | string | No | - | Structured output schema advertised to MCP clients; must match `ctx.structuredOutput.schema` |
| `outputSchema.version` | string | No | - | Structured output schema version advertised to MCP clients; must match `ctx.structuredOutput.schemaVersion` |
| `annotations.title` | string | No | - | Human-readable title |
| `annotations.readOnlyHint` | boolean | No | - | Tool only reads data |
| `annotations.destructiveHint` | boolean | No | - | Tool may modify/delete data |
| `annotations.idempotentHint` | boolean | No | - | Safe to retry |
| `annotations.openWorldHint` | boolean | No | - | May access external resources |

### Workflow Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | - | Unique identifier, must match filename |
| `title` | string | Yes | - | Display title |
| `description` | string | Yes | - | Workflow description |
| `tools` | string[] | Yes | - | Tool IDs in this workflow |
| `availability.mcp` | boolean | No | `true` | Available via MCP |
| `availability.cli` | boolean | No | `true` | Available via CLI |
| `selection.mcp.defaultEnabled` | boolean | No | `false` | Enabled when no workflows configured |
| `selection.mcp.autoInclude` | boolean | No | `false` | Auto-include when predicates pass |
| `predicates` | string[] | No | `[]` | Visibility predicates (all must pass) |

## Module Path

The `module` field specifies where to find the tool implementation. It uses a package-relative path without file extension:

```
mcp/tools/<category>/<tool_name>
```

At runtime, this resolves to:
```
build/mcp/tools/<category>/<tool_name>.js
```

The module must export named exports: `{ schema, handler }`

Note: `name`, `description`, and `annotations` are defined in the YAML manifest, not the module.

Example module structure:
```typescript
// src/mcp/tools/simulator/build_sim.ts
import { z } from 'zod';

export const schema = z.object({
  projectPath: z.string().describe('Path to project'),
  // ...
});

export async function handler(params: z.infer<typeof schema>) {
  // Implementation
}
```

## Naming Conventions

### Tool ID
- Use `snake_case`: `build_sim`, `list_devices`
- Must match the YAML filename (without `.yaml`)
- Must be unique across all tools

### MCP Name (`names.mcp`)
- Use `snake_case` or `kebab-case` consistently
- Must be globally unique across all tools
- This is what LLMs see and call

### CLI Name (`names.cli`)
- Optional; if omitted, derived from MCP name
- Derivation: `snake_case` → `kebab-case` (`build_sim` → `build-sim`)
- Use `kebab-case` for explicit names

### Workflow ID
- Use `kebab-case`: `simulator`, `swift-package`, `ui-automation`
- Must match the YAML filename (without `.yaml`)

## Predicates

Predicates control visibility based on runtime context. All predicates in the array must pass (AND logic) for the tool/workflow to be visible.

### Available Predicates

| Predicate | Description |
|-----------|-------------|
| `debugEnabled` | Show only when `config.debug` is `true` |
| `experimentalWorkflowDiscoveryEnabled` | Show only when experimental workflow discovery is enabled |
| `mcpRuntimeOnly` | Show only in MCP runtime (hide in CLI/daemon catalogs) |
| `runningUnderXcodeAgent` | Show only when running under Xcode's coding agent |
| `hideWhenXcodeAgentMode` | Hide when running inside Xcode's coding agent (tools conflict with Xcode's native equivalents) |
| `xcodeAutoSyncDisabled` | Show only when running under Xcode and `config.disableXcodeAutoSync` is `true` |
| `always` | Always visible (explicit documentation) |
| `never` | Never visible (temporarily disable) |

Notes:
- Bridge availability/connection is handled at tool call time, not as a visibility predicate.
- Prefer runtime/config predicates for deterministic tool exposure.

### Predicate Context

Predicates receive a context object:

```typescript
interface PredicateContext {
  runtime: 'cli' | 'mcp' | 'daemon';
  config: ResolvedRuntimeConfig;
  runningUnderXcode: boolean;
}
```

### Adding New Predicates

To add a new predicate, edit `src/visibility/predicate-registry.ts`:

```typescript
export const PREDICATES: Record<string, PredicateFn> = {
  // Existing predicates...

  myNewPredicate: (ctx: PredicateContext): boolean => {
    return ctx.config.someFlag === true;
  },
};
```

## Workflow Selection Rules

For MCP runtime, workflows are selected based on these rules (in order):

1. **Auto-include workflows** (`autoInclude: true`) when their predicates pass
2. **Explicitly requested workflows** from `config.enabledWorkflows`
3. **Default workflows** (`defaultEnabled: true`) when `config.enabledWorkflows` is empty
4. All selected workflows are filtered by availability + predicates

### Selection Examples

```yaml
# Always included (autoInclude with no predicates = always passes)
selection:
  mcp:
    autoInclude: true

# Enabled by default when no workflows configured
selection:
  mcp:
    defaultEnabled: true

# MCP-only workflow/tool visibility
predicates:
  - mcpRuntimeOnly

# Auto-included only when predicates pass (e.g., debug mode)
selection:
  mcp:
    autoInclude: true
predicates:
  - debugEnabled

# Show only when manual Xcode sync is needed
predicates:
  - xcodeAutoSyncDisabled
```

## Tool Re-export

A single tool can belong to multiple workflows. This is useful for shared utilities:

```yaml
# manifests/workflows/simulator.yaml
tools:
  - clean           # Shared tool
  - discover_projs  # Shared tool
  - build_sim

# manifests/workflows/device.yaml
tools:
  - clean           # Same tool, different workflow
  - discover_projs  # Same tool, different workflow
  - build_device
```

The tool is defined once in `manifests/tools/clean.yaml` but referenced by both workflows.

## Daemon Routing

Daemon routing is intentionally simple:

- **`routing.stateful: true`**: CLI routes this tool through the daemon.
- **`routing` omitted or `stateful: false`**: CLI runs the tool directly.
- **Special-case**: dynamic `xcode-ide` bridge tools use daemon-backed routing for bridge session persistence.

## Validation

Manifests are validated at load time against Zod schemas. Invalid manifests cause startup failures with descriptive error messages.

The schema definitions are in `src/core/manifest/schema.ts`.

## Runtime Tool Registration

At startup, tools are registered dynamically from manifests:

```
1. loadManifest()
   └── Reads all YAML files from manifests/tools/ and manifests/workflows/
   └── Validates against Zod schemas
   └── Returns { tools: Map, workflows: Map }

2. selectWorkflowsForMcp(workflows, requestedWorkflows, ctx)
   └── Filters workflows by availability (mcp: true)
   └── Applies selection rules (defaultEnabled, autoInclude)
   └── Evaluates predicates against context

3. For each selected workflow:
   └── For each tool ID in workflow.tools:
       └── Look up tool manifest by ID
       └── Check tool availability and predicates
       └── importToolModule(module) → { schema, handler, annotations }
       └── Load outputSchema from schemas/structured-output/<schema>/<version>.schema.json
       └── server.registerTool(mcpName, { inputSchema, outputSchema, annotations }, handler)
```

Key files:
- `src/core/manifest/load-manifest.ts` - Manifest loading and caching
- `src/core/manifest/import-tool-module.ts` - Dynamic tool module imports
- `src/core/manifest/import-resource-module.ts` - Dynamic resource module imports
- `src/utils/tool-registry.ts` - MCP server tool registration
- `src/core/resources.ts` - MCP server resource registration
- `src/runtime/tool-catalog.ts` - CLI/daemon tool catalog building
- `src/visibility/exposure.ts` - Workflow/tool/resource visibility filtering

## Resource Manifest Format

Resource manifests define MCP resources exposed by the server.

### Schema

```yaml
# Required fields
id: string              # Unique resource identifier (must match filename without .yaml)
module: string          # Module path (see Module Path section)
name: string            # MCP resource name
uri: string             # Resource URI (e.g., xcodebuildmcp://simulators)
description: string     # Resource description
mimeType: string        # MIME type for the resource content

# Optional fields
availability:           # Per-runtime availability flags
  mcp: boolean          # Available via MCP server (default: true)
predicates: string[]    # Predicate names for visibility filtering (default: [])
```

### Example: Basic Resource

```yaml
id: simulators
module: mcp/resources/simulators
name: simulators
uri: xcodebuildmcp://simulators
description: Available iOS simulators with their UUIDs and states
mimeType: text/plain
```

### Example: Predicate-Gated Resource

```yaml
id: xcode-ide-state
module: mcp/resources/xcode-ide-state
name: xcode-ide-state
uri: xcodebuildmcp://xcode-ide-state
description: "Current Xcode IDE selection (scheme and simulator) from Xcode's UI state"
mimeType: application/json
predicates:
  - runningUnderXcodeAgent  # Only exposed when running under Xcode
```

### Resource Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | - | Unique identifier, must match filename |
| `module` | string | Yes | - | Module path relative to `src/` (extensionless) |
| `name` | string | Yes | - | MCP resource name |
| `uri` | string | Yes | - | Resource URI |
| `description` | string | Yes | - | Resource description |
| `mimeType` | string | Yes | - | Content MIME type |
| `availability.mcp` | boolean | No | `true` | Available via MCP |
| `predicates` | string[] | No | `[]` | Visibility predicates (all must pass) |

### Resource Module Contract

Resource modules must export a named `handler` function:

```typescript
// src/mcp/resources/simulators.ts
export async function handler(uri: URL): Promise<{ contents: Array<{ text: string }> }> {
  // Implementation
}
```

Metadata (name, description, URI, mimeType) is defined in the YAML manifest, not the module.

## Creating a New Tool

1. **Create the tool module** in `src/mcp/tools/<category>/<tool_name>.ts`
2. **Create the manifest** in `manifests/tools/<tool_name>.yaml`
3. **Add to workflow(s)** in `manifests/workflows/<workflow>.yaml`
4. **Run tests** to validate

Example checklist:
- [ ] Tool ID matches filename
- [ ] Module path is correct
- [ ] MCP name is unique
- [ ] Tool is added to at least one workflow
- [ ] `outputSchema` references the schema produced by `ctx.structuredOutput`, if the tool returns structured content
- [ ] Predicates reference valid predicate names
- [ ] Availability flags match intended runtimes

## Creating a New Workflow

1. **Create the manifest** in `manifests/workflows/<workflow_id>.yaml`
2. **Add tool references** (tools must already exist)
3. **Configure selection rules** for MCP behavior
4. **Run tests** to validate

Example checklist:
- [ ] Workflow ID matches filename
- [ ] All referenced tool IDs exist
- [ ] Selection rules are appropriate
- [ ] Predicates reference valid predicate names
