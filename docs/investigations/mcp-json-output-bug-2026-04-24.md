# Investigation: MCP Client Returns JSON Output

## Summary
XcodeBuildMCP is returning a valid dual-channel MCP tool result: human-readable text in `content[]` plus a JSON envelope in top-level `structuredContent`. The fixtures pass because MCP snapshots validate the text channel and JSON snapshots validate the structured channel separately; a real MCP client that prefers `structuredContent` will show JSON even though the text channel is correct.

## Symptoms
- Snapshot fixtures for MCP, CLI, and JSON output are correct.
- When running XcodeBuildMCP in a real MCP client, tool calls return JSON output instead of the expected MCP text output.

## Background / Prior Research

### Git archaeology: structured output changes

- Recent structured-output work introduced a two-channel MCP response: human-readable `content[0].text` plus `structuredContent` JSON envelope.
- The snapshot tiers appear to validate different response fields: MCP fixtures validate rendered text content; JSON fixtures validate `structuredContent`; CLI fixtures validate CLI text output.
- Relevant commits surfaced by the probe:
  - `3a1f548f` introduced `StructuredOutputEnvelope`, `ToolDomainResult`, and MCP `structuredContent` response data.
  - `cef40735`, `ba182dbd`, and `3df874a5` stabilized rendering/fixture parity.
  - `b4faec8b` changed streaming output to the domain-fragment model.
  - `bb786ff6` fixed CLI JSON error envelopes when structured output is absent.
  - `cc8f8467` is a WIP two-path output simplification that makes MCP/JSON non-streaming behavior stricter.
- Preliminary conclusion: fixtures can all be correct while a real MCP client shows JSON because fixtures may snapshot `content[0].text` while the client displays `structuredContent`.

### MCP protocol / SDK behavior

- The installed SDK version is `@modelcontextprotocol/sdk` `1.27.1`.
- MCP tool results support both `content` and `structuredContent`.
- SDK/spec behavior: tools with an `outputSchema` must provide `structuredContent`; tools returning structured content should also provide a text `content` block for backwards compatibility.
- The SDK validates that `structuredContent` is present when an output schema exists.
- Client behavior is not uniform. The probe found that VS Code currently prefers `structuredContent` and passes JSON to the model instead of the `content` text, while some other clients use `content`.
- Relevant external references surfaced by the probe:
  - MCP tools spec: https://modelcontextprotocol.io/docs/concepts/tools
  - MCP discussion: https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1563
  - MCP issue: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624
  - VS Code issue: https://github.com/microsoft/vscode/issues/290063

## Investigator Findings

### 2026-04-24 - MCP dual-channel response flow

**Finding:** The hypothesis is supported, with one nuance: the MCP snapshot harness does not blindly read `content[0].text`; it iterates the MCP `content[]` array and refuses multiple text blocks, so the stored MCP fixture is effectively the single text block while `structuredContent` is separately captured.

**Runtime response shape evidence:**
- `src/utils/tool-registry.ts:19-48` converts a render session into the MCP `ToolResponse`. It builds `content` from `session.finalize()` text plus image attachments, then conditionally adds top-level `structuredContent` when `session.getStructuredOutput?.()` returns a value.
- `src/utils/tool-registry.ts:299-327` is the native MCP handler path: create a text render session, run the tool handler, copy `ctx.structuredOutput` into the session, post-process next steps, then return `sessionToToolResponse(session)`.
- `src/rendering/render.ts:36-99` stores fragments, attachments, and structured output in the same render session. `setStructuredOutput` also marks the session as an error when the domain result has `didError`.
- `src/utils/structured-output-envelope.ts:10-22` converts domain results into the public JSON envelope by hoisting `schema`, `schemaVersion`, `didError`, and `error`, and putting the remaining domain fields under `data`.
- Representative tool path: `src/mcp/tools/project-discovery/show_build_settings.ts:107-113` sets `ctx.structuredOutput` to schema `xcodebuildmcp.output.build-settings`; `src/mcp/tools/project-discovery/show_build_settings.ts:163-166` calls that setter after execution. The matching text fixture is human-readable at `src/snapshot-tests/__fixtures__/mcp/project-discovery/show-build-settings--success.txt:1-30`, while the JSON fixture starts with the structured envelope at `src/snapshot-tests/__fixtures__/json/project-discovery/show-build-settings--success.json:1-11`.

**Snapshot harness evidence:**
- `src/snapshot-tests/mcp-harness.ts:36-65` extracts only text blocks from `result.content`, throws on invalid content, and throws if more than one text block is present. This validates the human-readable text channel, not the full MCP tool result.
- `src/snapshot-tests/mcp-harness.ts:68-78` separately reads top-level `result.structuredContent` into `structuredEnvelope`.
- `src/snapshot-tests/mcp-harness.ts:111-121` returns both `text` and `structuredEnvelope`, but snapshot suites generally compare the `text` field via `expectFixture`; for example `src/snapshot-tests/suites/project-discovery-suite.ts:78-83` compares `text` for the MCP/runtime fixture.
- `src/snapshot-tests/json-harness.ts:5-24` does not exercise the CLI `--output json` path. It wraps the MCP harness, requires `result.structuredEnvelope`, then formats that envelope as the JSON fixture.
- `src/snapshot-tests/harness.ts:25-66` is the CLI text snapshot path: it spawns `node build/cli.js <workflow> <tool> --json <args>` without `--output json` and snapshots stdout text.

**CLI JSON path separation evidence:**
- `src/cli/register-tool-commands.ts:93-116` implements real CLI `--output json` by writing `handlerContext.structuredOutput` through `toStructuredEnvelope`, or a synthetic error envelope if no structured output exists.
- `src/cli/register-tool-commands.ts:347-391` chooses the render session based on `--output`; for `json`, it runs the invocation and then writes only the JSON envelope instead of finalizing text output.
- Therefore the three observed fixture tiers validate distinct surfaces: CLI text stdout, MCP text `content[]`, and MCP `structuredContent` formatted as JSON. They do not prove that a real MCP client will prefer the text channel when both MCP channels are present.

**Tool registration / `outputSchema` evidence:**
- Native MCP registration in `src/utils/tool-registry.ts:290-297` passes `description`, `inputSchema`, and `annotations` to `server.registerTool`; it does not advertise `outputSchema`.
- `outputSchema` does not appear in `manifests/` tool definitions. The only source hits are bridge metadata/types and the investigation report.
- Dynamic Xcode Tools bridge proxy registration in `src/integrations/xcode-tools-bridge/registry.ts:94-119` also registers only `description`, `inputSchema`, `annotations`, and `_meta`; it does not pass remote `outputSchema` to the SDK.
- Bridge metadata still preserves remote output schema information for listing/fingerprinting: `src/integrations/xcode-tools-bridge/core.ts:21-38` serializes `outputSchema`, and `src/integrations/xcode-tools-bridge/registry.ts:126-134` includes it in the stable fingerprint.
- Bridge call results preserve remote `structuredContent` when present: `src/integrations/xcode-tools-bridge/bridge-tool-result.ts:30-57` copies `result.structuredContent` into the bridge payload.

**Eliminated hypotheses:**
- The MCP runtime is not selecting the CLI JSON renderer for native tool calls. It creates `createRenderSession('text')` in `src/utils/tool-registry.ts:301` and returns text plus optional `structuredContent`.
- MCP fixtures are not validating the full MCP result object. They validate the extracted text channel for MCP fixtures and only use `structuredContent` for the separate JSON fixture tier.
- `outputSchema` is not the trigger for native tools because it is not advertised during native `server.registerTool` registration. The structured JSON appears because tool handlers set `ctx.structuredOutput`, not because the client was given an output schema.

**Conclusion:** XcodeBuildMCP is returning a valid dual-channel MCP result for structured tools: human-readable text in `content[]` and a machine-readable JSON envelope in top-level `structuredContent`. Snapshot coverage can remain green because MCP text fixtures check the text channel, while JSON fixtures intentionally check the structured channel. A real MCP client that prefers or forwards `structuredContent` will surface JSON even though the text channel is correct. The likely issue is client display/forwarding preference interacting with XcodeBuildMCP's unconditional `structuredContent` emission for structured tools, not a broken text renderer or fixture mismatch.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The runtime MCP server path may be selecting the JSON renderer or returning structured JSON fields in a way that real clients prefer over textual MCP content, while snapshot fixtures validate a different path.
**Findings:** Report created; external git/protocol facts will be gathered before broad workspace selection.
**Evidence:** User symptom report; current branch has extensive output-formatting changes in progress.
**Conclusion:** Confirmed by later phases: the issue is not an accidental CLI JSON renderer path; it is a full MCP response containing both text and structured JSON, combined with client-side preference for the structured channel.

## Root Cause

XcodeBuildMCP emits `structuredContent` whenever a tool produces structured output, while still emitting human-readable text in `content[]`.

The key path is `src/utils/tool-registry.ts:19-48`: `sessionToToolResponse()` finalizes text into `content`, then conditionally adds top-level `structuredContent` from `session.getStructuredOutput()`. Native MCP tool calls reach that through `src/utils/tool-registry.ts:299-327`, which creates a text render session, runs the tool, copies `ctx.structuredOutput` into the session, and returns the combined response.

The test harnesses validate these channels separately:

- `src/snapshot-tests/mcp-harness.ts:36-65` extracts text blocks from `result.content` for MCP fixtures.
- `src/snapshot-tests/mcp-harness.ts:68-78` separately extracts `result.structuredContent`.
- `src/snapshot-tests/json-harness.ts:5-24` formats that MCP `structuredContent` as the JSON fixture.
- `src/cli/register-tool-commands.ts:93-116` and `src/cli/register-tool-commands.ts:347-391` show CLI `--output json` is a separate path, not what the JSON fixture harness exercises.

So the observed real-client behavior is explained by a client displaying or forwarding `structuredContent` instead of the text content. This is especially plausible for clients with a structured-output-first policy. The text renderer is not broken, and MCP mode is not accidentally using the CLI JSON renderer.

One design concern remains: native static tools currently do not advertise `outputSchema` during `server.registerTool()` (`src/utils/tool-registry.ts:290-297`), even though they may return `structuredContent`. That is not the immediate cause, but it is a weak public contract if structured MCP output is intended to be supported API.

## Recommendations

1. Decide the MCP API contract before changing code:
   - If structured MCP output is public API, keep `structuredContent`, add/advertise native `outputSchema`, and document that some clients may show JSON.
   - If the primary product goal is LLM-readable tool output, make normal MCP responses text-only or make structured MCP output explicitly opt-in.
2. Do not try to fix this in the text renderer; the renderer is already producing the expected human-readable content.
3. Add a full MCP result-shape test for representative tools such as `list_sims`, `session_show_defaults`, and `show_build_settings`, asserting both `content` text and `structuredContent` presence/absence according to the chosen contract.
4. Add a `listTools` contract test that locks whether native tools advertise `outputSchema`.
5. Add an explicit CLI `--output json` regression test if CLI JSON is a supported external contract, because current JSON fixtures are derived from MCP `structuredContent`, not the CLI JSON path.
6. If the bug report is specifically from VS Code or another named MCP client, capture that client's exact full `CallToolResult` and display policy before choosing between text-only, opt-in structured output, or documentation/client-side mitigation.

## Preventive Measures

- Snapshot the full normalized MCP `CallToolResult`, not only extracted text and separately formatted JSON.
- Maintain a small client-policy simulation test: one text-first policy and one structured-first policy. This would expose when a valid dual-channel response produces poor user-facing behavior in structured-first clients.
- Treat `structuredContent` as public API if emitted to MCP clients: either advertise schemas and document the contract, or keep it behind an explicit mode.
- Keep CLI JSON, MCP text, and MCP structured output tests clearly named so future fixture parity work does not conflate the three surfaces.
