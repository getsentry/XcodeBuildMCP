# XcodeBuildMCP Code Quality Guide

This guide consolidates all code quality, linting, and architectural compliance information for the XcodeBuildMCP project.

## Table of Contents

1. [Overview](#overview)
2. [ESLint Configuration](#eslint-configuration)
3. [Architectural Rules](#architectural-rules)
4. [Development Scripts](#development-scripts)
5. [Code Pattern Violations](#code-pattern-violations)
6. [Type Safety Migration](#type-safety-migration)
7. [Best Practices](#best-practices)

## Overview

XcodeBuildMCP enforces code quality through multiple layers:

1. **ESLint**: Handles general code quality, TypeScript rules, and stylistic consistency
2. **TypeScript**: Enforces type safety with strict mode
3. **Pattern Checker**: Enforces XcodeBuildMCP-specific architectural rules
4. **Migration Scripts**: Track progress on type safety improvements

## ESLint Configuration

### Current Configuration

The project uses a comprehensive ESLint setup that covers:

- TypeScript type safety rules
- Code style consistency
- Import ordering
- Unused variable detection
- Testing best practices

### ESLint Rules

For detailed ESLint rules and rationale, see [ESLINT_TYPE_SAFETY.md](ESLINT_TYPE_SAFETY.md).

### Running ESLint

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

## Architectural Rules

XcodeBuildMCP enforces several architectural patterns that cannot be expressed through ESLint:

### 1. Dependency Injection Pattern

**Rule**: MCP tool logic functions that orchestrate complex, long-running processes with sub-processes (e.g., `xcodebuild`) must use dependency injection for external interactions. This is because standard vitest mocking produces race conditions when sub-process ordering is non-deterministic.

Standalone utility modules that invoke simple, short-lived commands (e.g., `xcrun devicectl list`, `xcrun xcresulttool get`) may use direct `child_process`/`fs` imports and be tested with standard vitest mocking.

✅ **Allowed**:
- `createMockExecutor()` / `createMockFileSystemExecutor()` for complex process orchestration in tool logic
- Logic functions accepting `executor?: CommandExecutor` parameter for xcodebuild and similar pipelines
- Direct `child_process`/`fs` imports in standalone utility modules with simple commands, tested via vitest mocking

❌ **Forbidden**:
- Testing handler functions directly
- Real external side effects in unit tests (real `xcodebuild`, `xcrun`, AXe, filesystem writes/reads outside test harness)

### 2. Handler Signature Compliance

**Rule**: MCP handlers must have exact signatures as required by the SDK.

✅ **Tool Handler Signature**:
```typescript
async handler(args: Record<string, unknown>): Promise<ToolResponse>
```

✅ **Resource Handler Signature**:
```typescript
async handler(uri: URL): Promise<{ contents: Array<{ text: string }> }>
```

❌ **Forbidden**:
- Multiple parameters in handlers
- Optional parameters
- Dependency injection parameters in handlers

### 3. Testing Architecture

**Rule**: Tests must only call logic functions, never handlers directly.

✅ **Correct Pattern**:
```typescript
const result = await myToolLogic(params, mockExecutor);
```

❌ **Forbidden Pattern**:
```typescript
const result = await myTool.handler(params);
```

### 4. Server Type Safety

**Rule**: MCP server instances must use proper SDK types, not generic casts.

✅ **Correct Pattern**:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
const server = (globalThis as { mcpServer?: McpServer }).mcpServer;
server.server.createMessage({...});
```

❌ **Forbidden Pattern**:
```typescript
const server = (globalThis as { mcpServer?: Record<string, unknown> }).mcpServer;
const serverInstance = (server.server ?? server) as Record<string, unknown> & {...};
```

## Development Scripts

### Core Scripts

```bash
# Build the project
npm run build

# Run type checking
npm run typecheck

# Run tests
npm run test

# Check code patterns (architectural compliance)
node scripts/check-code-patterns.js

# Check type safety migration progress
npm run check-migration
```

### Pattern Checker Usage

The pattern checker enforces XcodeBuildMCP-specific architectural rules:

```bash
# Check all patterns
node scripts/check-code-patterns.js

# Check specific pattern type
node scripts/check-code-patterns.js
node scripts/check-code-patterns.js --pattern=execsync
node scripts/check-code-patterns.js --pattern=handler
node scripts/check-code-patterns.js --pattern=handler-testing
node scripts/check-code-patterns.js --pattern=server-typing

# Get help
node scripts/check-code-patterns.js --help
```

### Tool Summary Scripts

```bash
# Show tool and resource summary
npm run tools

# List all tools
npm run tools:list

# List both tools and resources
npm run tools:all
```

## Code Pattern Violations

The pattern checker identifies the following violations:

### 1. External-Boundary Mocking Violations

**What**: Tests that mock external side effects without injected executors/filesystem dependencies
**Why**: Breaks deterministic external-boundary testing
**Fix**: Use `createMockExecutor()` / `createMockFileSystemExecutor()` for external dependencies
### 2. ExecSync Violations

**What**: Direct use of Node.js child_process functions in production code
**Why**: Bypasses CommandExecutor dependency injection
**Fix**: Accept `CommandExecutor` parameter and use it

### 3. Handler Signature Violations

**What**: Handlers with incorrect parameter signatures
**Why**: MCP SDK requires exact signatures
**Fix**: Move dependencies inside handler body

### 4. Handler Testing Violations

**What**: Tests calling `.handler()` directly
**Why**: Violates dependency injection principle
**Fix**: Test logic functions instead

### 5. Improper Server Typing Violations

**What**: Casting MCP server instances to `Record<string, unknown>` or using custom interfaces instead of SDK types
**Why**: Breaks type safety and prevents proper API usage
**Fix**: Import `McpServer` from SDK and use proper typing instead of generic casts

## Type Safety Migration

The project is migrating to improved type safety using the `createTypedTool` factory:

### Check Migration Status

```bash
# Show summary
npm run check-migration

# Show detailed analysis
npm run check-migration:verbose

# Show only unmigrated tools
npm run check-migration:unfixed
```

### Migration Benefits

1. **Compile-time type safety** for tool parameters
2. **Automatic Zod schema validation**
3. **Better IDE support** and autocomplete
4. **Consistent error handling**

## Best Practices

### 1. Before Committing

Always run these checks before committing:

```bash
npm run build          # Ensure code compiles
npm run typecheck      # Check TypeScript types
npm run lint           # Check linting rules
npm run test           # Run tests
node scripts/check-code-patterns.js  # Check architectural compliance
```

### 2. Adding New Tools

1. Use dependency injection pattern
2. Follow handler signature requirements
3. Create comprehensive tests (test logic, not handlers)
4. Use `createTypedTool` factory for type safety
5. Document parameter schemas clearly

### 3. Writing Tests

1. Import the logic function, not the default export
2. Use `createMockExecutor()` / `createMockFileSystemExecutor()` for external side effects
3. Test three dimensions: validation, command generation, output processing
4. Never test handlers directly

### 4. Code Organization

1. Keep tools in appropriate workflow directories
2. Share common tools via `-shared` directories
3. Re-export shared tools, don't duplicate
4. Follow naming conventions for tools

## Automated Enforcement

The project uses multiple layers of automated enforcement:

1. **Pre-commit**: ESLint and TypeScript checks (if configured)
2. **CI Pipeline**: All checks run on every PR
3. **PR Blocking**: Checks must pass before merge
4. **Code Review**: Automated and manual review processes

## Troubleshooting

### ESLint False Positives

If ESLint reports false positives in test files, check that:
1. Test files are properly configured in `.eslintrc.json`
2. Test-specific rules are applied correctly
3. File patterns match your test file locations

### Pattern Checker Issues

If the pattern checker reports unexpected violations:
1. Check if it's a legitimate architectural violation
2. Verify the file is in the correct directory
3. Ensure you're using the latest pattern definitions

### Type Safety Migration

If migration tooling reports incorrect status:
1. Ensure the tool exports follow standard patterns
2. Check that schema definitions are properly typed
3. Verify the handler uses the schema correctly

## Future Improvements

1. **Automated Fixes**: Add auto-fix capability to pattern checker
2. **IDE Integration**: Create VS Code extension for real-time checking
3. **Performance Metrics**: Add build and test performance tracking
4. **Complexity Analysis**: Add code complexity metrics
5. **Documentation Linting**: Add documentation quality checks
