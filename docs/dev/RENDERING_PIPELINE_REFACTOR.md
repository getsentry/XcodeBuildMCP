# Rendering Pipeline Refactor Plan

## Goal

```
events -> render(events, strategy) -> text -> output(target)
```

Three steps. Two render strategies (text, json). Two output targets (stdout, ToolResponse envelope). No special cases for next-steps. No `_meta` coordination. No replay.

## Principles

1. **Two render strategies**: text (human-readable) and json (JSONL). That's it.
2. **Rendering is data in, text out.** A renderer takes events and produces strings. It doesn't know about stdout or ToolResponse.
3. **Output target is post-render.** After rendering produces text, the caller decides: write to stdout (CLI) or wrap in ToolResponse (MCP).
4. **Streaming is incremental rendering.** Same renderer, called event-by-event instead of all at once. The sink receives chunks progressively.
5. **Daemon is lifecycle, not rendering.** Daemon keeps a process alive for stateful tools. It sends events over the wire. The CLI renders them locally.
6. **ToolResponse is MCP transport only.** Internal code never constructs, inspects, or mutates ToolResponse. It's built once at the MCP boundary.
7. **Next-steps are events.** They flow through the renderer like any other event. No second render pass.

## Current State (problems)

- Three "renderers" (MCP, CLI Text, CLI JSONL) when there should be two strategies
- `mcp-renderer.ts` and `cli-text-renderer.ts` use the same formatters from `event-formatting.ts` — they're the same strategy with different sinks
- `toolResponse()` renders AND constructs ToolResponse — mixing rendering with transport
- `emitNextStepsEvent()` creates a second set of renderers for next-steps
- `printToolResponse()` inspects `_meta`, calculates deltas, replays leftover output
- `resolveRenderers()` always creates MCP renderer even in CLI mode
- `ToolResponse` used as internal data structure throughout invoker, daemon, CLI
- `_meta` used as undocumented coordination channel (events, streamed counts, pending state)

## Design

### Internal result type

Tools return events. Not ToolResponse.

```typescript
// src/types/tool-result.ts

interface ToolResult {
  events: PipelineEvent[];
  isError?: boolean;
  attachments?: ToolResponseContent[];  // non-event content (images only)
  nextSteps?: NextStep[];
  nextStepParams?: NextStepParamsMap;
}

interface PendingBuildResult {
  kind: 'pending-build';
  started: StartedPipeline;
  isError?: boolean;
  emitSummary: boolean;
  tailEvents: PipelineEvent[];
  fallbackContent: ToolResponseContent[];
  errorFallbackPolicy: 'always' | 'if-no-structured-diagnostics';
  includeBuildLogFileRef: boolean;
  includeParserDebugFileRef: boolean;
  meta?: Record<string, unknown>;
}

type ToolExecutionResult = ToolResult | PendingBuildResult;
```

`ToolResponse` stays in `src/types/common.ts` as the MCP SDK type. Internal code stops using it.

### Render function

Pure function. Events in, text out.

```typescript
// src/rendering/render.ts

type RenderStrategy = 'text' | 'json';

// Batch render — all events at once, returns complete output
function renderEvents(events: PipelineEvent[], strategy: RenderStrategy): string;

// Incremental render — for streaming. Returns a session.
interface RenderSession {
  push(event: PipelineEvent): string;  // returns rendered text for this event
  finalize(): string;                  // returns any buffered text (grouped diagnostics, summary)
}

function createRenderSession(strategy: RenderStrategy): RenderSession;
```

**Text strategy**: reuses all existing formatters from `event-formatting.ts`. Handles diagnostic grouping, summary generation, transient/durable distinction. The `push()` return value is the rendered text for that event (may be empty for grouped events like compiler-error that are deferred until summary).

**JSON strategy**: `push()` returns `JSON.stringify(event) + '\n'`. `finalize()` returns `''`.

### Sink (output target)

The caller decides what to do with the rendered text. This is not a class or interface — it's just what the boundary code does.

**CLI text mode:**
```typescript
const session = createRenderSession('text');
for (const event of result.events) {
  const text = session.push(event);
  if (text) process.stdout.write(formatCliTextLine(text) + '\n');
}
const final = session.finalize();
if (final) process.stdout.write(final);
```

**CLI json mode:**
```typescript
const session = createRenderSession('json');
for (const event of result.events) {
  process.stdout.write(session.push(event));
}
```

**MCP boundary:**
```typescript
const text = renderEvents(result.events, 'text');
const response: ToolResponse = {
  content: [
    { type: 'text', text },
    ...(result.attachments ?? []),
  ],
  isError: result.isError || undefined,
};
```

**Streaming (xcodebuild CLI):**
```typescript
const session = createRenderSession('text');
// During build execution, pipeline calls emitEvent for each parsed event:
function emitEvent(event: PipelineEvent) {
  const text = session.push(event);
  if (text) process.stdout.write(formatCliTextLine(text) + '\n');
}
// After build completes and next-steps resolved:
emitEvent(nextStepsEvent);
const final = session.finalize();
if (final) process.stdout.write(final);
```

### Interactive progress (CLI text)

The CLI text renderer currently has spinner/transient line behavior for build stages and test progress. This stays in the text strategy but the `push()` return distinguishes durable vs transient text:

```typescript
interface TextRenderOp {
  text: string;
  transient?: boolean;  // true = progress line that can be overwritten
}
```

The CLI stdout sink handles transient lines using the existing `CliProgressReporter`. The MCP sink ignores transient ops. This is the only place where the sink needs to know more than "here's a string".

### Tool handler changes

`toolResponse()` becomes a pure data constructor:

```typescript
// src/utils/tool-response.ts
function toolResponse(events: PipelineEvent[], options?): ToolResult {
  return {
    events,
    isError: detectError(events) || undefined,
    nextStepParams: options?.nextStepParams,
  };
}
```

No rendering. No resolveRenderers(). No _meta.

Handler signature in `src/runtime/types.ts`:
```typescript
handler: (params: Record<string, unknown>) => Promise<ToolExecutionResult>;
```

### Invoker flow

```typescript
// src/runtime/tool-invoker.ts — simplified executeTool

async executeTool(tool, args, opts): Promise<ToolResult> {
  const result = await tool.handler(args);
  return finalizeResult(tool, result, this.catalog);
}
```

`finalizeResult()` replaces `postProcessToolResponse()`:
1. If pending build: finalize pipeline, get events
2. Resolve next-steps from manifest templates (existing logic, unchanged)
3. Push next-steps event to events array
4. Strip nextSteps/nextStepParams
5. Return `ToolResult`

No rendering. No emitNextStepsEvent(). No second renderer pass.

### CLI entry point

```typescript
// src/cli/register-tool-commands.ts — simplified

const strategy = outputFormat === 'json' ? 'json' : 'text';
const session = createRenderSession(strategy);

// For streaming tools, pass emitEvent into the invocation
const emitEvent = (event: PipelineEvent) => {
  const rendered = session.push(event);
  if (rendered) writeToStdout(rendered, strategy);
};

const result = await invoker.invokeDirect(tool, args, { 
  runtime: 'cli', 
  emitEvent,  // xcodebuild pipeline uses this for live streaming
});

// Finalize (flushes grouped diagnostics, summary)
const finalText = session.finalize();
if (finalText) writeToStdout(finalText, strategy);

// Print non-event attachments (images)
printAttachments(result.attachments);

if (result.isError) process.exitCode = 1;
```

`printToolResponse()` is deleted. Its job is done by the boundary code above.

### MCP entry point

```typescript
// src/utils/tool-registry.ts — simplified

const result = await invoker.invoke(toolName, args, { runtime: 'mcp' });
const text = renderEvents(result.events, 'text');
return {
  content: [
    { type: 'text', text },
    ...(result.attachments ?? []),
  ],
  isError: result.isError || undefined,
};
```

### Daemon flow

Daemon doesn't render. It runs the tool, collects events, sends them to CLI.

**Daemon server:**
```typescript
const result = await invoker.invoke(toolName, args, { runtime: 'daemon' });
return { events: result.events, attachments: result.attachments, isError: result.isError };
```

**CLI after daemon response:**
```typescript
// Received events from daemon — render them locally
const session = createRenderSession(strategy);
for (const event of daemonResult.events) {
  const text = session.push(event);
  if (text) writeToStdout(text, strategy);
}
const final = session.finalize();
if (final) writeToStdout(final, strategy);
printAttachments(daemonResult.attachments);
```

Same rendering code path as direct CLI invocation. Daemon is just transport.

### Xcodebuild streaming

The pipeline stops owning renderers. It accepts an `emitEvent` callback.

```typescript
// src/utils/xcodebuild-pipeline.ts — key change

interface PipelineOptions {
  operation: XcodebuildOperation;
  toolName: string;
  params: Record<string, unknown>;
  minimumStage?: XcodebuildStage;
  emitEvent?: (event: PipelineEvent) => void;  // NEW: live event sink
}
```

When `emitEvent` is provided (CLI direct), events stream to stdout in real-time through the render session. When not provided (MCP, daemon), events are buffered and rendered after completion.

Pipeline finalization returns events only:
```typescript
interface PipelineResult {
  state: XcodebuildRunState;
  events: PipelineEvent[];
}
```

No `mcpContent`. No renderer finalization. The caller renders.

### Next-steps format

One canonical text format. No CLI-vs-MCP branching.

Current MCP format is the canonical one:
```
Next steps:
1. launch_app_sim({ simulatorId: "ABC-123", bundleId: "com.example.app" })
2. stop_app_sim({ simulatorId: "ABC-123" })
```

CLI command format (`xcodebuildmcp simulator launch-app-sim --simulator-id "..."`) becomes a presentation concern in the CLI sink layer if desired, not a rendering concern. Initially, use the canonical format everywhere.

## What Gets Deleted

| File/Function | Reason |
|---------------|--------|
| `src/utils/renderers/mcp-renderer.ts` | Replaced by text strategy + MCP boundary wrapping |
| `src/utils/renderers/cli-text-renderer.ts` | Replaced by text strategy + CLI stdout writing |
| `src/utils/renderers/cli-jsonl-renderer.ts` | Replaced by json strategy + CLI stdout writing |
| `src/utils/renderers/index.ts` (`resolveRenderers`) | No longer needed — strategy selected at boundary |
| `emitNextStepsEvent()` in tool-invoker.ts | Next-steps pushed to events before render |
| `printToolResponse()` complex logic | Boundary code handles output directly |
| `_meta.events`, `_meta.streamedEventCount`, `_meta.streamedContentCount` | No coordination channel needed |
| `_meta.pendingXcodebuild` | Typed `PendingBuildResult` instead |
| `suppressCliStream` option | No CLI rendering in toolResponse() to suppress |

## What Stays

| Component | Why |
|-----------|-----|
| `event-formatting.ts` | Pure formatters, shared by text strategy |
| `PipelineEvent` types | The event model is correct |
| `tool-event-builders.ts` | Event factory functions |
| `xcodebuild-event-parser.ts` | Parsing is not a rendering concern |
| `xcodebuild-run-state.ts` | Event ordering/dedup is not a rendering concern |
| `CliProgressReporter` | Interactive progress stays as a CLI sink concern |
| `terminal-output.ts` | CLI text coloring stays as a CLI sink concern |
| Next-step template resolution logic | Business logic, unchanged |

## New Files

| File | Purpose |
|------|---------|
| `src/types/tool-result.ts` | `ToolResult`, `PendingBuildResult`, `ToolExecutionResult` |
| `src/rendering/render.ts` | `renderEvents()`, `createRenderSession()`, `RenderSession` |

Two new files. That's it.

## Migration Order

1. **Add `ToolResult` type** — additive, no existing code changes
2. **Add `renderEvents()` and `createRenderSession()`** — extract text strategy from existing `cli-text-renderer.ts` and `mcp-renderer.ts` (they use the same formatters). Add json strategy. Independently testable.
3. **Change `toolResponse()` to return `ToolResult`** — stop rendering, just store events. Update all call sites (mechanical type change).
4. **Change handler contract** to `Promise<ToolExecutionResult>` in `types.ts` and `typed-tool-factory.ts`. Update tool modules.
5. **Replace `postProcessToolResponse` with `finalizeResult`** — push next-steps to events. Delete `emitNextStepsEvent()`.
6. **Refactor xcodebuild pipeline** — remove renderer ownership, accept `emitEvent` callback, return events only. Update pending result helpers. Update build/test tools.
7. **Switch CLI boundary** — create render session, pass `emitEvent`, delete `printToolResponse()` complex logic.
8. **Switch MCP boundary** — render at boundary, construct ToolResponse.
9. **Switch daemon protocol** — send events over wire, render locally on CLI. Bump protocol version.
10. **Delete old renderers** — `mcp-renderer.ts`, `cli-text-renderer.ts`, `cli-jsonl-renderer.ts`, `resolveRenderers()`.
11. **Update docs and tests.**

This should land as one atomic branch. Mixed old/new paths recreate the complexity.

## Daemon Protocol

Bump `DAEMON_PROTOCOL_VERSION` to 2. Wire payload changes from:
```typescript
{ response: ToolResponse }
```
to:
```typescript
{ events: PipelineEvent[], attachments?: ToolResponseContent[], isError?: boolean }
```

Old CLI + new daemon (or vice versa) fails fast with a restart instruction.

## Risk

- ~50 `toolResponse()` call sites need type changes (mechanical)
- Handler contract change touches `types.ts`, `typed-tool-factory.ts`, `tool-registry.ts`, all tool modules
- Daemon protocol bump requires atomic client+server update
- Next-steps text format change is user-visible
- Test churn is significant

All of this is bounded and mechanical. The event model, parsing, formatting, and business logic are unchanged.
