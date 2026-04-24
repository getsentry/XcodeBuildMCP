# Tool Authoring Cookbook

This is the end-to-end contributor guide for creating, modifying, deleting, and validating XcodeBuildMCP tools.

Use this cookbook when a change affects any tool's runtime behavior, MCP metadata, CLI surface, structured output, schemas, docs, or fixtures.

Related references:
- Manifest fields: `docs/dev/MANIFEST_FORMAT.md`
- Streaming vs non-streaming output model: `docs/dev/ADDING_TOOLS_OUTPUT_MODEL.md`
- Schema versioning: `docs/SCHEMA_VERSIONING.md`
- Testing guidance: `docs/dev/TESTING.md`

## Mental model

A tool is defined across several layers:

| Layer | Location | Purpose |
|---|---|---|
| Tool implementation | `src/mcp/tools/<workflow>/<tool>.ts` | Input validation, execution, final structured result |
| Tool manifest | `manifests/tools/<tool>.yaml` | MCP/CLI names, description, annotations, output schema metadata, visibility |
| Workflow manifest | `manifests/workflows/<workflow>.yaml` | Which workflows expose the tool |
| Structured output schema | `schemas/structured-output/<schema>/1.schema.json` | Canonical JSON contract for `structuredContent` and CLI JSON fixtures |
| Snapshot fixtures | `src/snapshot-tests/__fixtures__/{mcp,cli,json}/...` | Expected MCP text, CLI text, and structured JSON outputs |
| Generated docs | `docs/TOOLS.md`, `docs/TOOLS-CLI.md` | User-facing tool reference generated from manifests |

The final structured result is the canonical data contract. Text output is rendered from that result and runtime-specific presentation logic.

## Before changing a tool

1. Find the tool manifest in `manifests/tools/`.
2. Find the implementation from the manifest `module` field.
3. Find the workflow manifest(s) that include the tool ID.
4. Find the output schema named by `outputSchema.schema` in the manifest.
5. Find existing fixtures under:
   - `src/snapshot-tests/__fixtures__/mcp/<workflow>/`
   - `src/snapshot-tests/__fixtures__/cli/<workflow>/`
   - `src/snapshot-tests/__fixtures__/json/<workflow>/`

Do not edit generated docs or fixtures blindly. Understand which runtime surface changed first.

## Create a new tool

### 1. Pick the tool shape

Use a non-streaming tool when it computes a result and returns once.

Examples:
- list tools
- query tools
- metadata lookups
- session defaults

Use a streaming tool when users benefit from live progress.

Examples:
- build
- build and run
- test
- long-running process launch

See `docs/dev/ADDING_TOOLS_OUTPUT_MODEL.md` for the exact executor patterns.

### 2. Create the implementation

Create:

```text
src/mcp/tools/<workflow>/<tool_name>.ts
```

The module must export:

```ts
export const schema = schemaObject.shape;
export const handler = createTypedTool(...);
```

or the session-aware equivalent when appropriate.

The handler must set structured output:

```ts
ctx.structuredOutput = {
  result,
  schema: 'xcodebuildmcp.output.example-result',
  schemaVersion: '1',
};
```

For build-like tools, use the existing helper:

```ts
setXcodebuildStructuredOutput(ctx, 'build-result', result);
```

Do not manually return MCP `content` text from normal tools. The renderer owns text output.

### 3. Define the structured result

Prefer an existing result kind when the shape already fits.

Examples:
- `xcodebuildmcp.output.build-result`
- `xcodebuildmcp.output.app-path`
- `xcodebuildmcp.output.simulator-action-result`

Create a new schema only when no existing schema accurately describes the payload.

If adding a new schema, create:

```text
schemas/structured-output/xcodebuildmcp.output.<name>/1.schema.json
```

The schema should validate the entire envelope:

```json
{
  "schema": "xcodebuildmcp.output.<name>",
  "schemaVersion": "1",
  "didError": false,
  "error": null,
  "data": {}
}
```

Keep root `$schema` and `$id`. Reuse shared definitions from:

```text
schemas/structured-output/_defs/common.schema.json
```

Canonical schemas may use absolute `$ref`s. MCP runtime bundles those refs into local `$defs` before advertising `outputSchema`.

### 4. Create the tool manifest

Create:

```text
manifests/tools/<tool_id>.yaml
```

Minimal shape:

```yaml
id: example_tool
module: mcp/tools/<workflow>/example_tool
names:
  mcp: example_tool
  cli: example-tool
description: Do one clear thing.
annotations:
  title: Example Tool
  readOnlyHint: true
  destructiveHint: false
  openWorldHint: false
outputSchema:
  schema: xcodebuildmcp.output.example-result
  version: "1"
```

Use `outputSchema` for every tool that sets `ctx.structuredOutput`. The schema/version must match the values used by the tool's structured result.

### 5. Add the tool to a workflow

Edit:

```text
manifests/workflows/<workflow>.yaml
```

Add the manifest `id` to `tools:`.

A tool can be referenced by multiple workflows, but it should be defined once in `manifests/tools/`.

### 6. Generate docs

If you add, remove, or modify tool metadata, run:

```bash
npm run docs:update
npm run docs:check
```

Do not hand-edit `docs/TOOLS.md` or `docs/TOOLS-CLI.md`.

### 7. Add or update fixtures

Add representative MCP, CLI, and JSON fixtures for the new behavior.

Run snapshot updates with full output preserved:

```bash
npm run test:snapshots:update 2>&1 | tee /tmp/snapshot-update.txt
```

If running the full snapshot suite against a simulator/device, follow `docs/dev/TESTING.md` and preserve full logs. Snapshot tests are slow and environment-sensitive, so inspect failures before updating fixtures.

### 8. Validate schemas and fixtures

Run:

```bash
npm run test:schema-fixtures
```

This validates generated JSON fixtures in `src/snapshot-tests/__fixtures__/json/**` against the canonical schemas in `schemas/structured-output/**`.

If it fails, fix the source of drift:
- update the tool result if the payload is wrong
- update the schema if the payload is now the intended contract
- create a new schema version if the change is breaking for consumers

## Modify an existing tool

### Edit tool metadata

Change the manifest first:

```text
manifests/tools/<tool>.yaml
```

Metadata includes:
- `description`
- `names.mcp`
- `names.cli`
- `annotations`
- `availability`
- `predicates`
- `routing`
- `outputSchema`

Then run:

```bash
npm run docs:update
npm run docs:check
```

If the MCP or CLI name changes, update tests, docs, fixtures, and any next-step references that call the old name.

### Edit input parameters

Input parameters live in the tool implementation's Zod schema.

After changing parameters:

1. Update descriptions on the Zod fields.
2. Keep mutually exclusive parameters enforced in the schema or tool requirements.
3. Update tests for valid and invalid inputs.
4. Update fixtures if text or JSON output changes.
5. Run docs generation because CLI/MCP docs are generated from tool schemas/manifests.

Commands:

```bash
npm run docs:update
npm run docs:check
npm run typecheck
npm run test:schema-fixtures
```

### Edit structured output

Structured output changes must keep three things aligned:

1. The tool's `ctx.structuredOutput` schema name/version.
2. The manifest `outputSchema` metadata.
3. The canonical schema file.

For compatible additions, update the existing schema version and fixtures.

For breaking changes, add a new schema version file:

```text
schemas/structured-output/xcodebuildmcp.output.<name>/2.schema.json
```

Then update the tool and manifest to emit:

```ts
schemaVersion: '2'
```

and:

```yaml
outputSchema:
  schema: xcodebuildmcp.output.<name>
  version: "2"
```

Run:

```bash
npm run test:schema-fixtures
npx vitest run src/core/__tests__/structured-output-schema.test.ts
```

The second command validates the MCP `outputSchema` bundling path.

## Delete a tool

1. Remove the tool ID from all workflow manifests.
2. Delete `manifests/tools/<tool>.yaml`.
3. Delete the implementation file if no longer used.
4. Delete tests that only covered that tool.
5. Delete fixtures for MCP, CLI, and JSON output.
6. Run docs generation.

Commands:

```bash
npm run docs:update
npm run docs:check
npm run typecheck
npm test
npm run test:schema-fixtures
```

Do not delete a shared schema just because one tool stopped using it. Schemas are published API; only remove unpublished or clearly unused files after checking consumers.

## Maintain fixtures

Fixtures are not golden decorations; they are the output contract.

| Fixture tree | Validates |
|---|---|
| `__fixtures__/mcp` | Human-readable MCP `content[]` text |
| `__fixtures__/cli` | CLI text output |
| `__fixtures__/json` | Structured JSON envelope from MCP `structuredContent` |

When behavior changes intentionally:

1. Update the implementation.
2. Regenerate fixtures.
3. Review fixture diffs manually.
4. Validate JSON fixtures against schemas.
5. Commit implementation, schemas, fixtures, and generated docs together.

Do not update snapshot fixtures just to make tests pass. If a fixture changes unexpectedly, assume code is wrong until proven otherwise.

## Required checks before handoff

For documentation-only changes, checks may be skipped if the change does not affect generated docs.

For tool changes, run at least:

```bash
npm run docs:update
npm run docs:check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:schema-fixtures
```

For output or fixture changes, also run the relevant snapshot suite/update flow and preserve full output in a log file:

```bash
npm run test:snapshots 2>&1 | tee /tmp/snapshot-results.txt
npm run test:snapshots:update 2>&1 | tee /tmp/snapshot-update.txt
```

For MCP output schema changes, also run:

```bash
npx vitest run src/core/__tests__/structured-output-schema.test.ts
npx vitest run --config vitest.smoke.config.ts src/smoke-tests/__tests__/e2e-mcp-discovery.test.ts
```

## Common mistakes

- Adding a tool implementation but forgetting the manifest.
- Adding a manifest but forgetting the workflow reference.
- Setting `ctx.structuredOutput` but forgetting manifest `outputSchema`.
- Changing JSON payload shape without updating schema and fixtures.
- Updating fixtures without reviewing why they changed.
- Hand-editing generated tool docs.
- Relying on streamed fragments for final output data.
- Adding fallback behavior instead of making the requested path canonical.
