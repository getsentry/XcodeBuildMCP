# Development Rules

## Build & Test
- `npm run build` - Build (wireit + tsup, ESM)
- `npm run test` - Unit/integration tests (Vitest)
- `npm run test:smoke` - Smoke tests (builds first, serial execution)
- `npm run lint` / `npm run lint:fix` - ESLint
- `npm run format` / `npm run format:check` - Prettier
- `npm run typecheck` - TypeScript type checking (src + test config)

## Architecture
ESM TypeScript project (`type: module`). Key layers:

- `src/cli/` - CLI entrypoint, yargs wiring, daemon routing
- `src/server/` - MCP stdio server, lifecycle, workflow/resource registration
- `src/runtime/` - Config bootstrap, session state, tool catalog assembly
- `src/core/manifest/` - YAML manifest loading, validation, tool module imports
- `src/mcp/tools/` - Tool implementations grouped by workflow (mirrors `manifests/workflows/`)
- `src/mcp/resources/` - MCP resource implementations
- `src/integrations/` - External integrations (Xcode tools bridge)
- `src/utils/` - Shared helpers (execution, logging, validation, responses)
- `src/visibility/` - Tool/workflow exposure predicates
- `src/daemon/` - Background daemon for persistent sessions
- `src/rendering/` - Output rendering and formatting
- `src/types/` - Shared type definitions

## Contributing Workflow
1. Create a branch from `main`
2. Make changes following the conventions in this file
3. Run the pre-commit checklist before committing:
   ```bash
   npm run lint:fix
   npm run typecheck
   npm run format
   npm run build
   npm test
   ```
4. Update `CHANGELOG.md` under `## [Unreleased]`
5. Update documentation if adding or modifying features
6. Clone and test against example projects (e.g., `XcodeBuildMCP-iOS-Template`) when changes affect runtime behavior
7. Push and create a pull request with a clear description
8. Link any related issues

## Code Quality
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Follow TypeScript best practices

## Import Conventions
- ESM with explicit `.ts` extensions in `src/` (tsup rewrites to `.js` at build)
- No `.js` imports in `src/` (enforced by ESLint)
- No barrel imports from `utils/index` - import from specific submodules (e.g., `src/utils/execution/index.ts`, `src/utils/logging/index.ts`)

## Test Conventions
- Vitest with colocated `__tests__/` directories using `*.test.ts`
- Smoke tests in `src/smoke-tests/__tests__/` (separate Vitest config, serial execution)
- Use `vi.mock`/`vi.hoisted` for isolation; inject executors and mock file systems
- MCP integration tests use `McpServer`, `InMemoryTransport`, and `Client`
- External dependencies (command execution, file system) must use dependency injection via `createMockExecutor()` / `createMockFileSystemExecutor()` from `src/test-utils/`

## Tool Development
- Tool manifests in `manifests/tools/*.yaml` define `id`, `module`, `names.mcp` (snake_case), optional `names.cli` (kebab-case), predicates, and annotations
- Workflow manifests in `manifests/workflows/*.yaml` group tools and define exposure rules
- Tool modules export a Zod `schema`, a pure `*Logic` function, and a `handler` built with `createTypedTool` or `createSessionAwareTool`
- Resource modules export a `handler` (and a pure `*Logic` function); `uri`, `name`, `description`, and `mimeType` are declared in `manifests/resources/*.yaml`

## Commands
- NEVER commit unless user asks

## GitHub
When reading issues:
- Always read all comments on the issue
-
## Tools
- GitHub CLI for issues/PRs
- CLI design note: do not rely on CLI session-default writes. CLI is intentionally deterministic for CI/scripting and should use explicit command arguments as the primary input surface.
- When working on skill sources in `skills/`, use the `skill-creator` skill workflow.
- After modifying any skill source, run `npx skill-check <skill-directory>` and address all errors/warnings before handoff.
-
## Style
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Docs
- Do not commit transient investigation notes, prompt exports, or scratch analysis docs after the work is complete.
- If an investigation leaves unresolved follow-up work, move it to a GitHub issue instead of preserving the transient doc in the branch.

### Changelog
Location: `CHANGELOG.md`

#### Format
Use these sections under `## [Unreleased]`:
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features
-
#### Rules
- Before adding entries, read the full `[Unreleased]` section to see which subsections already exist
- New entries ALWAYS go under `## [Unreleased]` section
- Append to existing subsections (e.g., `### Fixed`), do not create duplicates
- NEVER modify already-released version sections (e.g., `## [0.12.2]`)
- Each version section is immutable once released
- NEVER update snapshot fixtures unless asked to do so, these are integration tests, on failure assume code is wrong before questioning the fixture
-
#### Attribution
- **Internal changes (from issues)**: `Fixed foo bar ([#123](https://github.com/getsentry/XcodeBuildMCP/issues/123))`
- **External contributions**: `Added feature X ([#456](https://github.com/getsentry/XcodeBuildMCP/pull/456) by [@username](https://github.com/username))`

## Test Execution Rules
- When running long test suites (snapshot tests, smoke tests), ALWAYS write full output to a log file and read it afterwards. NEVER pipe through `tail` or `grep` directly — that loses output you may need to debug failures.
- Pattern: `DEVICE_ID=... npm run test:snapshot 2>&1 | tee /tmp/snapshot-results.txt` then read `/tmp/snapshot-results.txt` with the native read tool.
- If you need a summary, read the log file and grep/filter it — the full output is always preserved.
- Snapshot test command: `DEVICE_ID=<YOUR_DEVICE_ID> npm run test:snapshot`
- **Snapshot suite expected duration**: ~7 min baseline (measured at 423s). Anything longer than ~10 min should be treated as a likely hang, not a slow run.
  - Do NOT just kill the run — first inspect the process tree (`ps -ef | grep -E "vitest|xcodebuild|simctl|devicectl"`) to identify what's stuck.
  - Common hang causes: locked physical device, stale simulator state, `devicectl diagnose` waiting for password, orphaned daemon process.
  - Capture what you find before killing, so the root cause can be fixed rather than papered over.
- If physical-device snapshot tests hang after the final test summary, the likely cause is Apple post-failure diagnostics invoking `devicectl diagnose`, which may prompt for a macOS password and wedge in automated runs.
- When asked to review changes or test failures, focus on regressions: behavior changes caused by the branch. Do not treat known/acceptable test flakes, environment setup issues, or nondeterministic tool output churn as regressions unless explicitly asked to investigate them.

## **CRITICAL** Tool Usage Rules **CRITICAL**
- NEVER use sed/cat to read a file or a range of a file. Always use the native read tool.
- You MUST read every file you modify in full before editing.
