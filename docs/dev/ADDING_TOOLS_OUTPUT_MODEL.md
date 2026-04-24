# Adding New Tools: Streaming vs Non-Streaming Output

This repo uses a strict two-path output model for tools:

1. **Streaming tools** emit fragments during execution **and** produce a final structured result.
2. **Non-streaming tools** produce a final structured result only. They cannot emit fragments.

The final structured result is always the canonical final output.

## Quick decision rule

Use a **non-streaming tool** when the tool computes a result and returns it once.

Examples:
- list simulators
- show build settings
- session defaults
- clean
- get coverage report

Use a **streaming tool** when the tool has meaningful intermediate progress that should surface while the tool is running.

Examples:
- build
- build and run
- test
- long-running process launch with phases/progress

## The rule in one sentence

- **Non-streaming**: `return result` — no execution context at all
- **Streaming**: `emit fragments while running`, then `return result` — receives a `StreamingExecutionContext`

A non-streaming tool cannot emit fragments and should not try.
A streaming tool emits fragments through its execution context, not through the handler context.

## Canonical ownership

### Final structured result
The final result must contain everything needed for final rendering.

For build-like tools, that includes `request`.

Example:

```ts
ctx.structuredOutput = {
  result: {
    kind: 'build-result',
    request: {
      scheme: params.scheme,
      projectPath: params.projectPath,
      configuration: 'Debug',
      platform: 'iOS Simulator',
    },
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED', durationMs: 3200 },
    artifacts: { buildLogPath: '/tmp/build.log' },
    diagnostics: { warnings: [], errors: [] },
  },
  schema: 'xcodebuildmcp.output.build-result',
  schemaVersion: '1',
};
```

### Fragment stream
Fragments are only for streaming tools. They surface live intermediate state such as:

- invocation header
- build stages
- test discovery
- test failures while running
- phase transitions

## Executor types

Two executor shapes exist in `src/types/tool-execution.ts`:

```ts
// Non-streaming: accepts args, returns a result. No execution context.
export type NonStreamingExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
) => Promise<TResult>;

// Streaming: accepts args and a StreamingExecutionContext for live fragment emission.
export type StreamingExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
  ctx: StreamingExecutionContext,
) => Promise<TResult>;
```

These are distinct type surfaces. Use the one that matches your tool.

## Non-streaming tool pattern

A non-streaming tool should:

1. compute its result
2. set `ctx.structuredOutput`
3. return

Non-streaming tools do **not** receive a `StreamingExecutionContext`.
They cannot emit fragments at all.

Minimal example:

```ts
export function createListThingsExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<ListThingsParams, ThingListDomainResult> {
  return async (params) => {
    const items = await loadThings(params.root, executor);
    return {
      kind: 'thing-list',
      didError: false,
      error: null,
      items,
    };
  };
}

export async function listThingsLogic(
  params: ListThingsParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const result = await createListThingsExecutor(executor)(params);

  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.thing-list',
    schemaVersion: '1',
  };
}
```

That is enough.

Do **not** do this for a non-streaming tool:

```ts
ctx.emit(createBuildInvocationFragment(...));      // wrong: no streaming
createStreamingExecutionContext(ctx);              // wrong: no streaming
```

If the final text output needs header data, put that data on the final result.

## Streaming tool pattern

A streaming tool should:

1. build a canonical invocation request
2. emit the invocation fragment explicitly from the logic function via `ctx.emit(...)`
3. create the execution context with `createStreamingExecutionContext(ctx)`
4. stream progress fragments via `executionContext.emitFragment(...)` / pipeline
5. set structured output with the final result

Minimal example:

```ts
export async function buildThingLogic(
  params: BuildThingParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const request = createBuildThingRequest(params);

  ctx.emit(createBuildInvocationFragment('build-result', 'BUILD', request));

  const executionContext = createStreamingExecutionContext(ctx);
  const result = await createBuildThingExecutor(executor, request)(params, executionContext);

  setXcodebuildStructuredOutput(ctx, 'build-result', result);
}
```

Example executor shape:

```ts
export function createBuildThingExecutor(
  executor: CommandExecutor,
  request: BuildInvocationRequest,
): StreamingExecutor<BuildThingParams, BuildResultDomainResult> {
  return async (params, ctx) => {
    const started = createDomainStreamingPipeline('build_thing', 'BUILD', ctx, 'build-result');

    const commandResult = await runBuild(params, executor, started.pipeline);

    return createBuildDomainResult({
      started,
      succeeded: !commandResult.isError,
      target: 'simulator',
      artifacts: { buildLogPath: started.pipeline.logPath },
      fallbackErrorMessages: collectFallbackErrorMessages(started, [], commandResult.content),
      request,
    });
  };
}
```

## Build-like tools must populate `request`

For these result kinds, the final result must be self-sufficient:

- `build-result`
- `build-run-result`
- `test-result`

That means the final result must include:

```ts
request: BuildInvocationRequest
```

Do not rely on streamed invocation fragments to make final rendering work.

## `ctx.emit(...)` vs `executionContext.emitFragment(...)`

In streaming tools, two fragment emission sites exist:

- `ctx.emit(...)` — called from the logic function for the invocation header
  fragment, before the executor runs. This appears as a durable fragment in
  the render session.
- `executionContext.emitFragment(...)` — called from inside a streaming
  executor/pipeline for intermediate progress fragments (build stages, phase
  transitions, test progress, etc.).

Non-streaming tools have no `executionContext`, so this question doesn't apply.

## Anti-patterns

Do not introduce these patterns.

### 1. Calling `createStreamingExecutionContext(ctx)` from a non-streaming tool

Bad:

```ts
export async function showBuildSettingsLogic(params, executor) {
  const ctx = getHandlerContext();
  const executionContext = createStreamingExecutionContext(ctx); // wrong
  const result = await runShowBuildSettings(params, executor);
  ctx.structuredOutput = { ... };
}
```

Good:

```ts
export async function showBuildSettingsLogic(params, executor) {
  const ctx = getHandlerContext();
  const result = await createShowBuildSettingsExecutor(executor)(params);
  ctx.structuredOutput = { ... };
}
```

### 2. Emitting invocation fragments from a non-streaming tool

Bad:

```ts
ctx.emit(createBuildInvocationFragment(...)); // non-streaming tool
```

If the tool is static, the final rendering should derive everything from the
structured result, not from a fragment stream.

### 3. Post-hoc mutation of `result.request`

Bad:

```ts
const result = createBuildRunDomainResult({ ... });
result.request = invocationRequest;
```

Good:

```ts
const result = createBuildRunDomainResult({
  ...,
  request: invocationRequest,
});
```

### 4. Adding a third output channel

The only valid output channels are:

- the fragment stream (streaming tools only)
- `ctx.structuredOutput` (all tools)

Do not add an `executionContext.emitResult(...)` side channel or similar.

### 5. Using `NonStreamingExecutor` signature but emitting fragments inside

A `NonStreamingExecutor<TArgs, TResult>` takes `(args) => Promise<TResult>`.
There is no execution context argument. If your executor needs to emit
fragments, use `StreamingExecutor<TArgs, TResult>` instead.

## Current approved patterns

### Good: non-streaming tool

```ts
const result = await createFooExecutor(executor)(params);
ctx.structuredOutput = {
  result,
  schema: 'xcodebuildmcp.output.foo',
  schemaVersion: '1',
};
```

### Good: streaming build-like tool

```ts
ctx.emit(createBuildInvocationFragment('test-result', 'TEST', request));
const executionContext = createStreamingExecutionContext(ctx);
const result = await createTestExecutor(executor, request)(params, executionContext);
setXcodebuildStructuredOutput(ctx, 'test-result', result);
```

### Good: progress emitted inside streaming executor/pipeline

```ts
ctx.emitFragment({
  kind: 'build-run-result',
  fragment: 'phase',
  phase: 'install-app',
  status: 'started',
});
```

## Checklist for a new tool

### If the tool is non-streaming
- [ ] result contains everything needed for final rendering
- [ ] no invocation fragment emitted
- [ ] `ctx.structuredOutput` is set
- [ ] executor uses `NonStreamingExecutor<Params, Result>` signature
- [ ] does not call `createStreamingExecutionContext(...)`

### If the tool is streaming
- [ ] build a canonical `request`
- [ ] emit invocation fragment explicitly in the logic function via `ctx.emit(...)`
- [ ] use `createStreamingExecutionContext(ctx)` to obtain a `StreamingExecutionContext`
- [ ] executor uses `StreamingExecutor<Params, Result>` signature
- [ ] stream real progress fragments via the executor/pipeline
- [ ] final result includes `request`
- [ ] set structured output from the final result

## Sanity checks after adding a tool

Search for these smells:

```text
emitResult(
pendingInvocationRequest
result.request =
```

If you see them in new tool code, the implementation is probably drifting back toward the old hybrid model.

Also verify that non-streaming tools do not reference `createStreamingExecutionContext` or `StreamingExecutor`.

## Good reference files

### Non-streaming tools
- `src/mcp/tools/simulator/list_sims.ts`
- `src/mcp/tools/project-discovery/discover_projs.ts`
- `src/mcp/tools/project-discovery/show_build_settings.ts`
- `src/mcp/tools/session-management/session_show_defaults.ts`
- `src/mcp/tools/workflow-discovery/manage_workflows.ts`
- `src/mcp/tools/swift-package/swift_package_clean.ts`

### Streaming tools
- `src/mcp/tools/simulator/build_sim.ts`
- `src/mcp/tools/simulator/build_run_sim.ts`
- `src/mcp/tools/simulator/test_sim.ts`
- `src/mcp/tools/device/build_device.ts`
- `src/mcp/tools/device/build_run_device.ts`
- `src/mcp/tools/device/test_device.ts`
- `src/mcp/tools/macos/build_macos.ts`
- `src/mcp/tools/macos/build_run_macos.ts`
- `src/mcp/tools/macos/test_macos.ts`
- `src/mcp/tools/swift-package/swift_package_build.ts`
- `src/mcp/tools/swift-package/swift_package_run.ts`
- `src/mcp/tools/swift-package/swift_package_test.ts`
