# Bugbot Review Guide for XcodeBuildMCP

## Project Snapshot

XcodeBuildMCP is an MCP server exposing Xcode / Swift workflows as **tools** and **resources**.
Stack: TypeScript · Node.js · plugin-based auto-discovery (`src/mcp/tools`, `src/mcp/resources`).

For full details see [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 1. Security Checklist — Critical

* No hard-coded secrets, tokens or DSNs.
* All shell commands must flow through `CommandExecutor` with validated arguments (no direct `child_process` calls).
* Paths must be sanitised via helpers in `src/utils/validation.ts`.
* Sentry breadcrumbs / logs must **NOT** include user PII.

---

## 2. Architecture Checklist — Critical

| Rule | Quick diff heuristic |
|------|----------------------|
| Dependency injection only | New `child_process` \| `fs` import ⇒ **critical** |
| Handler / Logic split | `handler` > 20 LOC or contains branching ⇒ **critical** |
| Plugin auto-registration | Manual `registerTool(...)` / `registerResource(...)` ⇒ **critical** |

Positive pattern skeleton:

```ts
// src/mcp/tools/foo-bar.ts
export async function fooBarLogic(
  params: FooBarParams,
  exec: CommandExecutor = getDefaultCommandExecutor(),
  fs: FileSystemExecutor = getDefaultFileSystemExecutor(),
) {
  // ...
}

export const handler = (p: FooBarParams) => fooBarLogic(p);
```

---

## 3. Testing Checklist

* **External-boundary rule**: Use `createMockExecutor` / `createMockFileSystemExecutor` for command execution and filesystem side effects.
* **Internal mocking is allowed**: `vi.mock`, `vi.fn`, `vi.spyOn`, and `.mock*` are acceptable for internal modules/collaborators.
* Each tool must have tests covering happy-path **and** at least one failure path.
* Avoid the `any` type unless justified with an inline comment.

---

## 4. Documentation Checklist

* `docs/TOOLS.md` must exactly mirror the structure of `src/mcp/tools/**` (exclude `__tests__` and `*-shared`).
  *Diff heuristic*: if a PR adds/removes a tool but does **not** change `docs/TOOLS.md` ⇒ **warning**.
* Update public docs when CLI parameters or tool names change.

---

## 5. Common Anti-Patterns (and fixes)

| Anti-pattern | Preferred approach |
|--------------|--------------------|
| Complex logic in `handler` | Move to `*Logic` function |
| Re-implementing logging | Use `src/utils/logger.ts` |
| Direct `fs` / `child_process` usage | Inject `FileSystemExecutor` / `CommandExecutor` |
| Chained re-exports | Export directly from source |

---

### How Bugbot Can Verify Rules

1. **External-boundary violations**: confirm tests use injected executors/filesystem for external side effects.
2. **DI compliance**: search for direct `child_process` / `fs` imports outside approved patterns.
3. **Docs accuracy**: compare `docs/TOOLS.md` against `src/mcp/tools/**`.
4. **Style**: ensure ESLint and Prettier pass (`npm run lint`, `npm run format:check`).

---

Happy reviewing 🚀