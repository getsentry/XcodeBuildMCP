# Development Rules

## Code Quality
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Follow TypeScript best practices

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
- If modifying or adding/removing tools run `npm run docs:update` to update the TOOLS.md file, never edit this file directly.
-
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
-
#### Attribution
- **Internal changes (from issues)**: `Fixed foo bar ([#123](https://github.com/cameroncook/XcodeBuildMCP/issues/123))`
- **External contributions**: `Added feature X ([#456](https://github.com/cameroncook/XcodeBuildMCP/pull/456) by [@username](https://github.com/username))`

## **CRITICAL** Tool Usage Rules **CRITICAL**
- NEVER use sed/cat to read a file or a range of a file. Always use the native read tool.
- You MUST read every file you modify in full before editing.
