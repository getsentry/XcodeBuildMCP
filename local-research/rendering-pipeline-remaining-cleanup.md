# Rendering Pipeline Refactor — Remaining Cleanup

## Completed
- Render session module (src/rendering/)
- ToolHandlerContext via AsyncLocalStorage
- All 77 tool handlers emit via ctx
- Factory dual-mode (void → session, ToolResponse → passthrough)
- Pipeline inline finalization (pending pattern eliminated)
- CLI boundary re-renders via CLI text renderer
- MCP boundary creates session
- Snapshot normalizer stabilized for doctor output

## Remaining Cleanup (technical debt)

### 1. Remove hybrid toolResponse() usage from migrated tools
~40 tool handlers still call `toolResponse()` inside `withErrorHandling` mapError callbacks
or inner async functions, then extract events from `_meta.events` to re-emit through ctx.
These should be fully converted to direct ctx.emit() calls.

### 2. Remove ToolResponse type from tool handler signatures  
Once hybrid usage is removed, the `Promise<ToolResponse | void>` return types
can become `Promise<void>` and the ToolResponse import can be removed.

### 3. Daemon protocol v2
Send `{ events, attachments, isError }` over the wire instead of ToolResponse.
CLI renders locally. Requires protocol version bump.

### 4. Delete dead renderers
Once toolResponse() is removed from all tool handlers and the pipeline
no longer uses resolveRenderers() fallback:
- Delete src/utils/renderers/cli-jsonl-renderer.ts (used only by resolveRenderers)
- Potentially simplify renderers/index.ts

### 5. Encapsulate ToolResponse
Move ToolResponse type out of common.ts, make it module-private to the MCP
boundary (tool-registry.ts) and the daemon protocol.
