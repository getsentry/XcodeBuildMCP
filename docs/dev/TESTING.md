# XcodeBuildMCP Plugin Testing Guidelines

This document provides comprehensive testing guidelines for XcodeBuildMCP plugins, ensuring consistent, robust, and maintainable test coverage across the entire codebase.

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Test Architecture](#test-architecture)  
3. [Dependency Injection Strategy](#dependency-injection-strategy)
4. [Three-Dimensional Testing](#three-dimensional-testing)
5. [Test Organization](#test-organization)
6. [Test Patterns](#test-patterns)
7. [Performance Requirements](#performance-requirements)
8. [Coverage Standards](#coverage-standards)
9. [Common Patterns](#common-patterns)
10. [Manual Testing with Reloaderoo](#manual-testing-with-reloaderoo)
11. [Troubleshooting](#troubleshooting)

## Testing Philosophy

### 🚨 CRITICAL: External Dependency Mocking Rules

### When to use dependency-injection executors

`CommandExecutor` / `FileSystemExecutor` DI is required for **MCP tool logic functions** that orchestrate complex, long-running processes with sub-processes (e.g., `xcodebuild`, multi-step build pipelines). Standard vitest mocking produces race conditions with these because sub-process ordering is non-deterministic.

- `createMockExecutor()` / `createNoopExecutor()` for command execution in tool logic
- `createMockFileSystemExecutor()` / `createNoopFileSystemExecutor()` for file system interactions in tool logic

### When standard vitest mocking is fine

Standalone utility modules that invoke simple, short-lived commands (e.g., `xcrun devicectl list`, `xcrun xcresulttool get`) may use direct `child_process`/`fs` imports and be tested with standard vitest mocking (`vi.fn`, `vi.mock`, `vi.spyOn`, etc.). This is simpler and perfectly adequate for deterministic, single-command utilities.

### Internal mocking guidance:
- Vitest mocking (`vi.fn`, `vi.mock`, `vi.spyOn`, `.mockResolvedValue`, etc.) is allowed for internal modules and in-memory collaborators
- Prefer straightforward, readable test doubles over over-engineered mocks

### Still forbidden:
- Hitting real external systems in unit tests (real `xcodebuild`, `xcrun`, AXe, filesystem writes/reads outside test harness)

### OUR CORE PRINCIPLE

**Simple Rule**: Use dependency-injection mock executors for complex process orchestration in tool logic; use standard vitest mocking for simple utility modules and internal behavior.

**Why This Rule Exists**:
1. **Reliability**: Complex multi-process orchestration stays deterministic and hermetic via DI executors
2. **Simplicity**: Simple utilities use standard vitest mocking without unnecessary abstraction
3. **Architectural Enforcement**: External boundaries for complex processes are explicit in tool logic signatures
4. **Maintainability**: Tests fail for behavior regressions, not incidental environment differences

### Integration Testing with Dependency Injection

XcodeBuildMCP follows a dependency-injection testing philosophy for external boundaries:

- ✅ **Test plugin interfaces** (public API contracts)
- ✅ **Test integration flows** (plugin → utilities → external tools)
- ✅ **Use dependency injection** with createMockExecutor()/createMockFileSystemExecutor() for external dependencies
- ✅ **Use Vitest mocking when needed** for internal modules and collaborators

### Benefits

1. **Implementation Independence**: Internal refactoring doesn't break tests
2. **Real Coverage**: Tests verify actual user data flows
3. **Maintainability**: No brittle vitest mocks that break on implementation changes
4. **True Integration**: Catches integration bugs between layers
5. **Test Safety**: A Vitest setup file installs blocking executor overrides for unit tests

### Automated Violation Checking

To enforce external-boundary testing policy, the project includes a script that checks for architectural test-pattern violations.

```bash
# Run the script to check for violations
node scripts/check-code-patterns.js
```

This script is part of the standard development workflow and should be run before committing changes to ensure compliance with the testing standards.

### What the Script Flags vs. What It Should NOT Flag

#### ✅ LEGITIMATE VIOLATIONS (correctly flagged):
- Manual mock executors: `const mockExecutor = async (...) => { ... }`
- Manual filesystem mocks: `const mockFsDeps = { readFile: async () => ... }`
- Manual server mocks: `const mockServer = { ... }`
- External side-effect patterns that bypass injected executors/filesystem dependencies

#### ❌ FALSE POSITIVES (should NOT be flagged):
- Test data tracking: `commandCalls.push({ ... })` - This is just collecting test data, not mocking behavior
- Regular variables: `const testData = { ... }` - Non-mocking object assignments
- Test setup: Regular const assignments that don't implement mock behavior

The script has been refined to minimize false positives while catching all legitimate violations of our core rule.

## Test Architecture

### Correct Test Flow
```
Test → Plugin Handler → utilities → [DEPENDENCY INJECTION] createMockExecutor()
```

### What Gets Tested
- Plugin parameter validation
- Business logic execution  
- Command generation
- Response formatting
- Error handling
- Integration between layers

### What Gets Mocked
- Command execution via `createMockExecutor()`
- File system operations via `createMockFileSystemExecutor()`
- Internal modules can use Vitest mocks where appropriate

## Dependency Injection Strategy

### Handler Requirements

MCP tool logic functions that orchestrate complex processes must support dependency injection:

```typescript
export function tool_nameLogic(
  args: Record<string, unknown>, 
  commandExecutor: CommandExecutor,
  fileSystemExecutor?: FileSystemExecutor
): Promise<ToolResponse> {
  // Use injected executors
  const result = await executeCommand(['xcrun', 'simctl', 'list'], commandExecutor);
  return createTextResponse(result.output);
}

export default {
  name: 'tool_name',
  description: 'Tool description',
  schema: { /* zod schema */ },
  async handler(args: Record<string, unknown>): Promise<ToolResponse> {
    return tool_nameLogic(args, getDefaultCommandExecutor(), getDefaultFileSystemExecutor());
  },
};
```

**Important**: The dependency injection pattern applies to tool and resource handler logic that orchestrates complex, long-running processes (e.g., `xcodebuild`). Standalone utility modules with simple commands may use direct imports and standard vitest mocking.

Always use default parameter values (e.g., `= getDefaultCommandExecutor()`) in tool logic to ensure production code works without explicit executor injection, while tests can override with mock executors.

### Test Requirements

All tests must explicitly provide mock executors:

```typescript
it('should handle successful command execution', async () => {
  const mockExecutor = createMockExecutor({
    success: true,
    output: 'BUILD SUCCEEDED'
  });
  
  const result = await tool_nameLogic(
    { projectPath: '/test.xcodeproj', scheme: 'MyApp' },
    mockExecutor
  );
  
  expect(result.content[0].text).toContain('Build succeeded');
});
```

## Three-Dimensional Testing

Every plugin test suite must validate three critical dimensions:

### 1. Input Validation (Schema Testing)

Test parameter validation and schema compliance:

```typescript
describe('Parameter Validation', () => {
  it('should accept valid parameters', () => {
    const schema = z.object(tool.schema);
    expect(schema.safeParse({
      projectPath: '/valid/path.xcodeproj',
      scheme: 'ValidScheme'
    }).success).toBe(true);
  });
  
  it('should reject invalid parameters', () => {
    const schema = z.object(tool.schema);
    expect(schema.safeParse({
      projectPath: 123, // Wrong type
      scheme: 'ValidScheme'
    }).success).toBe(false);
  });
  
  it('should handle missing required parameters', async () => {
    const mockExecutor = createMockExecutor({ success: true });
    
    const result = await tool.handler({ scheme: 'MyApp' }, mockExecutor); // Missing projectPath
    
    expect(result).toEqual({
      content: [{
        type: 'text',
        text: "Required parameter 'projectPath' is missing. Please provide a value for this parameter."
      }],
      isError: true
    });
  });
});
```

### 2. Command Generation (CLI Testing)

### CRITICAL: No command spying allowed. Test command generation through response validation.

```typescript
describe('Command Generation', () => {
  it('should execute correct command with minimal parameters', async () => {
    const mockExecutor = createMockExecutor({
      success: true,
      output: 'BUILD SUCCEEDED'
    });
    
    const result = await tool.handler({
      projectPath: '/test.xcodeproj',
      scheme: 'MyApp'
    }, mockExecutor);
    
    // Verify through successful response - command was executed correctly
    expect(result.content[0].text).toContain('Build succeeded');
  });
  
  it('should handle paths with spaces correctly', async () => {
    const mockExecutor = createMockExecutor({
      success: true,
      output: 'BUILD SUCCEEDED'
    });
    
    const result = await tool.handler({
      projectPath: '/Users/dev/My Project/app.xcodeproj',
      scheme: 'MyApp'
    }, mockExecutor);
    
    // Verify successful execution (proper path handling)
    expect(result.content[0].text).toContain('Build succeeded');
  });
});
```

### 3. Output Processing (Response Testing)

Test response formatting and error handling:

```typescript
describe('Response Processing', () => {
  it('should format successful response', async () => {
    const mockExecutor = createMockExecutor({
      success: true,
      output: 'BUILD SUCCEEDED'
    });
    
    const result = await tool.handler({ projectPath: '/test', scheme: 'MyApp' }, mockExecutor);
    
    expect(result).toEqual({
      content: [{ type: 'text', text: '✅ Build succeeded for scheme MyApp' }]
    });
  });
  
  it('should handle command failures', async () => {
    const mockExecutor = createMockExecutor({
      success: false,
      output: 'Build failed with errors',
      error: 'Compilation error'
    });
    
    const result = await tool.handler({ projectPath: '/test', scheme: 'MyApp' }, mockExecutor);
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Build failed');
  });
  
  it('should handle executor errors', async () => {
    const mockExecutor = createMockExecutor(new Error('spawn xcodebuild ENOENT'));
    
    const result = await tool.handler({ projectPath: '/test', scheme: 'MyApp' }, mockExecutor);
    
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error during build: spawn xcodebuild ENOENT' }],
      isError: true
    });
  });
});
```

## Test Organization

### Directory Structure

```
src/plugins/[workflow-group]/
├── __tests__/
│   ├── index.test.ts          # Workflow metadata tests (canonical groups only)
│   ├── re-exports.test.ts     # Re-export validation (project/workspace groups only)
│   ├── tool1.test.ts          # Individual tool tests
│   ├── tool2.test.ts
│   └── ...
├── tool1.ts
├── tool2.ts
├── index.ts                   # Workflow metadata
└── ...
```

### Test File Types

#### 1. Tool Tests (`tool_name.test.ts`)
Test individual plugin tools with full three-dimensional coverage.

#### 2. Workflow Tests (`index.test.ts`)
Test workflow metadata for canonical groups:

```typescript
describe('simulator-workspace workflow metadata', () => {
  it('should have correct workflow name', () => {
    expect(workflow.name).toBe('iOS Simulator Workspace Development');
  });
  
  it('should have correct description', () => {
    expect(workflow.description).toBe(
      'Complete iOS development workflow for .xcworkspace files including build, test, deploy, and debug capabilities',
    );
  });
});
```

#### 3. Re-export Tests (`re-exports.test.ts`) 
Test re-export integrity for project/workspace groups:

```typescript
describe('simulator-project re-exports', () => {
  it('should re-export boot_sim from simulator-shared', () => {
    expect(bootSim.name).toBe('boot_sim');
    expect(typeof bootSim.handler).toBe('function');
  });
});
```

## Test Patterns

### Standard Test Template

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

// Use dependency-injection mocks for external boundaries.
// Vitest mocks are acceptable for internal collaborators when needed.

import tool from '../tool_name.ts';
import { createMockExecutor } from '../../utils/command.js';

describe('tool_name', () => {

  describe('Export Field Validation (Literal)', () => {
    it('should export correct name', () => {
      expect(tool.name).toBe('tool_name');
    });

    it('should export correct description', () => {
      expect(tool.description).toBe('Expected literal description');
    });

    it('should export handler function', () => {
      expect(typeof tool.handler).toBe('function');
    });

    // Schema validation tests...
  });

  describe('Command Generation', () => {
    it('should execute commands successfully', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Expected output'
      });
      
      const result = await tool.handler(validParams, mockExecutor);
      
      expect(result.content[0].text).toContain('Expected result');
    });
  });

  describe('Response Processing', () => {
    // Output handling tests...
  });
});
```

## Performance Requirements

### Test Execution Speed

- **Individual test**: < 100ms
- **Test file**: < 5 seconds  
- **Full test suite**: < 20 seconds
- **No real system calls**: Tests must use mocks

### Performance Anti-Patterns

❌ **Real command execution**:
```
[INFO] Executing command: xcodebuild -showBuildSettings...
```

❌ **Long timeouts** (indicates real calls)
❌ **File system operations** (unless testing file utilities)
❌ **Network requests** (unless testing network utilities)

## Coverage Standards

### Target Coverage
- **Overall**: 95%+
- **Plugin handlers**: 100%
- **Command generation**: 100%
- **Error paths**: 100%

### Coverage Validation
```bash
# Check coverage for specific plugin group
npm run test:coverage -- plugins/simulator-workspace/

# Ensure all code paths are tested
npm run test:coverage -- --reporter=lcov
```

### Required Test Paths

Every plugin test must cover:

- ✅ **Valid parameter combinations**
- ✅ **Invalid parameter rejection**  
- ✅ **Missing required parameters**
- ✅ **Successful command execution**
- ✅ **Command failure scenarios**
- ✅ **Executor error handling**
- ✅ **Output parsing edge cases**

## Common Patterns

### Testing Parameter Defaults

```typescript
it('should use default configuration when not provided', async () => {
  const mockExecutor = createMockExecutor({
    success: true,
    output: 'BUILD SUCCEEDED'
  });
  
  const result = await tool.handler({
    projectPath: '/test.xcodeproj',
    scheme: 'MyApp'
    // configuration intentionally omitted
  }, mockExecutor);
  
  // Verify default behavior through successful response
  expect(result.content[0].text).toContain('Build succeeded');
});
```

### Testing Complex Output Parsing

```typescript
it('should extract app path from build settings', async () => {
  const mockExecutor = createMockExecutor({
    success: true,
    output: `
      CONFIGURATION_BUILD_DIR = /path/to/build
      BUILT_PRODUCTS_DIR = /path/to/products  
      FULL_PRODUCT_NAME = MyApp.app
      OTHER_SETTING = ignored_value
    `
  });
  
  const result = await tool.handler({ projectPath: '/test', scheme: 'MyApp' }, mockExecutor);
  
  expect(result.content[0].text).toContain('/path/to/products/MyApp.app');
});
```

### Testing Error Message Formatting

```typescript
it('should format validation errors correctly', async () => {
  const mockExecutor = createMockExecutor({ success: true });
  
  const result = await tool.handler({}, mockExecutor); // Missing required params
  
  expect(result).toEqual({
    content: [{
      type: 'text',
      text: "Required parameter 'projectPath' is missing. Please provide a value for this parameter."
    }],
    isError: true
  });
});
```

## Manual Testing with Reloaderoo

### 🚨 CRITICAL: THOROUGHNESS OVER EFFICIENCY - NO SHORTCUTS ALLOWED

### ABSOLUTE PRINCIPLE: EVERY TOOL MUST BE TESTED INDIVIDUALLY

### 🚨 MANDATORY TESTING SCOPE - NO EXCEPTIONS
- **EVERY SINGLE TOOL** - All 83+ tools must be tested individually, one by one
- **NO REPRESENTATIVE SAMPLING** - Testing similar tools does NOT validate other tools
- **NO PATTERN RECOGNITION SHORTCUTS** - Similar-looking tools may have different behaviors
- **NO EFFICIENCY OPTIMIZATIONS** - Thoroughness is more important than speed
- **NO TIME CONSTRAINTS** - This is a long-running task with no deadline pressure

### ❌ FORBIDDEN EFFICIENCY SHORTCUTS
- **NEVER** assume testing `build_sim_id_proj` validates `build_sim_name_proj`
- **NEVER** skip tools because they "look similar" to tested ones
- **NEVER** use representative sampling instead of complete coverage
- **NEVER** stop testing due to time concerns or perceived redundancy
- **NEVER** group tools together for batch testing
- **NEVER** make assumptions about untested tools based on tested patterns

### ✅ REQUIRED COMPREHENSIVE APPROACH
1. **Individual Tool Testing**: Each tool gets its own dedicated test execution
2. **Complete Documentation**: Every tool result must be recorded, regardless of outcome
3. **Systematic Progress**: Use TodoWrite to track every single tool as tested/untested
4. **Failure Documentation**: Test tools that cannot work and mark them as failed/blocked
5. **No Assumptions**: Treat each tool as potentially unique requiring individual validation

### TESTING COMPLETENESS VALIDATION
- **Start Count**: Record exact number of tools discovered (e.g., 83 tools)
- **End Count**: Verify same number of tools have been individually tested
- **Missing Tools = Testing Failure**: If any tools remain untested, the testing is incomplete
- **TodoWrite Tracking**: Every tool must appear in todo list and be marked completed

### 🚨 CRITICAL: Black Box Testing via Reloaderoo Inspect

### DEFINITION: Black Box Testing
Black Box Testing means testing ONLY through external interfaces without any knowledge of internal implementation. For XcodeBuildMCP, this means testing exclusively through the Model Context Protocol (MCP) interface using Reloaderoo as the MCP client.

### 🚨 MANDATORY: RELOADEROO INSPECT IS THE ONLY ALLOWED TESTING METHOD

### ABSOLUTE TESTING RULES - NO EXCEPTIONS

1. **✅ ONLY ALLOWED: Reloaderoo Inspect Commands**
   - `npx reloaderoo@latest inspect call-tool "TOOL_NAME" --params 'JSON' -- node build/cli.js mcp`
   - `npx reloaderoo@latest inspect list-tools -- node build/cli.js mcp`
   - `npx reloaderoo@latest inspect read-resource "URI" -- node build/cli.js mcp`
   - `npx reloaderoo@latest inspect server-info -- node build/cli.js mcp`
   - `npx reloaderoo@latest inspect ping -- node build/cli.js mcp`

2. **❌ COMPLETELY FORBIDDEN ACTIONS:**
   - **NEVER** call `mcp__XcodeBuildMCP__tool_name()` functions directly
   - **NEVER** use MCP server tools as if they were native functions
   - **NEVER** access internal server functionality
   - **NEVER** read source code to understand how tools work
   - **NEVER** examine implementation files during testing
   - **NEVER** diagnose internal server issues or registration problems
   - **NEVER** suggest code fixes or implementation changes

3. **🚨 CRITICAL VIOLATION EXAMPLES:**
   ```typescript
   // ❌ FORBIDDEN - Direct MCP tool calls
   await mcp__XcodeBuildMCP__list_devices();
   await mcp__XcodeBuildMCP__build_sim_id_proj({ ... });
   
   // ❌ FORBIDDEN - Using tools as native functions
   const devices = await list_devices();
   const result = await doctor();
   
   // ✅ CORRECT - Only through Reloaderoo inspect
   npx reloaderoo@latest inspect call-tool "list_devices" --params '{}' -- node build/cli.js mcp
   npx reloaderoo@latest inspect call-tool "doctor" --params '{}' -- node build/cli.js mcp
   ```

### WHY RELOADEROO INSPECT IS MANDATORY
- **Higher Fidelity**: Provides clear input/output visibility for each tool call
- **Real-world Simulation**: Tests exactly how MCP clients interact with the server
- **Interface Validation**: Ensures MCP protocol compliance and proper JSON formatting
- **Black Box Enforcement**: Prevents accidental access to internal implementation details
- **Clean State**: Each tool call runs with a fresh MCP server instance, preventing cross-contamination

### IMPORTANT: STATEFUL TOOL LIMITATIONS

#### Reloaderoo Inspect Behavior:
Reloaderoo starts a fresh MCP server instance for each individual tool call and terminates it immediately after the response. This ensures:
- ✅ **Clean Testing Environment**: No state contamination between tool calls
- ✅ **Isolated Testing**: Each tool test is independent and repeatable
- ✅ **Real-world Accuracy**: Simulates how most MCP clients interact with servers

#### Expected False Negatives:
Some tools rely on in-memory state within the MCP server and will fail when tested via Reloaderoo inspect. These failures are **expected and acceptable** as false negatives:

- **`swift_package_stop`** - Requires in-memory process tracking from `swift_package_run`
- **`stop_app_device`** - Requires in-memory process tracking from `launch_app_device`  
- **`stop_app_sim`** - Requires in-memory process tracking from `launch_app_sim`
- **`stop_device_log_cap`** - Requires in-memory session tracking from `start_device_log_cap`
- **`stop_sim_log_cap`** - Requires in-memory session tracking from `start_sim_log_cap`
- **`stop_mac_app`** - Requires in-memory process tracking from `launch_mac_app`

#### Testing Protocol for Stateful Tools:
1. **Test the tool anyway** - Execute the Reloaderoo inspect command
2. **Expect failure** - Tool will likely fail due to missing state
3. **Mark as false negative** - Document the failure as expected due to stateful limitations
4. **Continue testing** - Do not attempt to fix or investigate the failure
5. **Report as finding** - Note in testing report that stateful tools failed as expected

### COMPLETE COVERAGE REQUIREMENTS
- ✅ **Test ALL 83+ tools individually** - No exceptions, every tool gets manual verification
- ✅ **Follow dependency graphs** - Test tools in correct order based on data dependencies
- ✅ **Capture key outputs** - Record UUIDs, paths, schemes needed by dependent tools
- ✅ **Test real workflows** - Complete end-to-end workflows from discovery to execution
- ✅ **Use programmatic JSON parsing** - Accurate tool/resource counting and discovery
- ✅ **Document all observations** - Record exactly what you see via testing
- ✅ **Report discrepancies as findings** - Note unexpected results without investigation

### MANDATORY INDIVIDUAL TOOL TESTING PROTOCOL

#### Step 1: Create Complete Tool Inventory
```bash
# Generate complete list of all tools
npx reloaderoo@latest inspect list-tools -- node build/cli.js mcp > /tmp/all_tools.json
TOTAL_TOOLS=$(jq '.tools | length' /tmp/all_tools.json)
echo "TOTAL TOOLS TO TEST: $TOTAL_TOOLS"

# Extract all tool names for systematic testing
jq -r '.tools[].name' /tmp/all_tools.json > /tmp/tool_names.txt
```

#### Step 2: Create TodoWrite Task List for Every Tool
```bash
# Create individual todo items for each of the 83+ tools
# Example for first few tools:
# 1. [ ] Test tool: doctor  
# 2. [ ] Test tool: list_devices
# 3. [ ] Test tool: list_sims
# ... (continue for ALL 83+ tools)
```

#### Step 3: Test Each Tool Individually
For EVERY tool in the list:
```bash
# Test each tool individually - NO BATCHING
npx reloaderoo@latest inspect call-tool "TOOL_NAME" --params 'APPROPRIATE_PARAMS' -- node build/cli.js mcp

# Mark tool as completed in TodoWrite IMMEDIATELY after testing
# Record result (success/failure/blocked) for each tool
```

#### Step 4: Validate Complete Coverage
```bash
# Verify all tools tested
COMPLETED_TOOLS=$(count completed todo items)
if [ $COMPLETED_TOOLS -ne $TOTAL_TOOLS ]; then
    echo "ERROR: Testing incomplete. $COMPLETED_TOOLS/$TOTAL_TOOLS tested"
    exit 1
fi
```

### CRITICAL: NO TOOL LEFT UNTESTED
- **Every tool name from the JSON list must be individually tested**
- **Every tool must have a TodoWrite entry that gets marked completed**
- **Tools that fail due to missing parameters should be tested anyway and marked as blocked**
- **Tools that require setup (like running processes) should be tested and documented as requiring dependencies**
- **NO ASSUMPTIONS**: Test tools even if they seem redundant or similar to others

### BLACK BOX TESTING ENFORCEMENT
- ✅ **Test only through Reloaderoo MCP interface** - Simulates real-world MCP client usage
- ✅ **Use task lists** - Track progress with TodoWrite tool for every single tool
- ✅ **Tick off each tool** - Mark completed in task list after manual verification
- ✅ **Manual oversight** - Human verification of each tool's input and output
- ❌ **Never examine source code** - No reading implementation files during testing
- ❌ **Never diagnose internal issues** - No investigation of build processes or tool registration
- ❌ **Never suggest implementation fixes** - Report issues as findings, don't solve them
- ❌ **Never use scripts for tool testing** - Each tool must be manually executed and verified

### 🚨 TESTING PSYCHOLOGY & BIAS PREVENTION

### COMMON ANTI-PATTERNS TO AVOID

#### 1. Efficiency Bias (FORBIDDEN)
- **Symptom**: "These tools look similar, I'll test one to validate the others"
- **Correction**: Every tool is unique and must be tested individually
- **Enforcement**: Count tools at start, verify same count tested at end

#### 2. Pattern Recognition Override (FORBIDDEN)  
- **Symptom**: "I see the pattern, the rest will work the same way"
- **Correction**: Patterns may hide edge cases, bugs, or different implementations
- **Enforcement**: No assumptions allowed, test every tool regardless of apparent similarity

#### 3. Time Pressure Shortcuts (FORBIDDEN)
- **Symptom**: "This is taking too long, let me speed up by sampling"
- **Correction**: This is explicitly a long-running task with no time constraints
- **Enforcement**: Thoroughness is the ONLY priority, efficiency is irrelevant

#### 4. False Confidence (FORBIDDEN)
- **Symptom**: "The architecture is solid, so all tools must work"
- **Correction**: Architecture validation does not guarantee individual tool functionality
- **Enforcement**: Test tools to discover actual issues, not to confirm assumptions

### MANDATORY MINDSET
- **Every tool is potentially broken** until individually tested
- **Every tool may have unique edge cases** not covered by similar tools
- **Every tool deserves individual attention** regardless of apparent redundancy
- **Testing completion means EVERY tool tested**, not "enough tools to validate patterns"
- **The goal is discovering problems**, not confirming everything works

### TESTING COMPLETENESS CHECKLIST
- [ ] Generated complete tool list (83+ tools)
- [ ] Created TodoWrite entry for every single tool
- [ ] Tested every tool individually via Reloaderoo inspect
- [ ] Marked every tool as completed in TodoWrite
- [ ] Verified tool count: tested_count == total_count
- [ ] Documented all results, including failures and blocked tools
- [ ] Created final report covering ALL tools, not just successful ones

### Tool Dependency Graph Testing Strategy

**CRITICAL: Tools must be tested in dependency order:**

1. **Foundation Tools** (provide data for other tools):
   - `doctor` - System info
   - `list_devices` - Device UUIDs
   - `list_sims` - Simulator UUIDs  
   - `discover_projs` - Project/workspace paths

2. **Discovery Tools** (provide metadata for build tools):
   - `list_schemes` - Scheme names
   - `show_build_settings` - Build settings

3. **Build Tools** (create artifacts for install tools):
   - `build_*` tools - Create app bundles
   - `get_*_app_path_*` tools - Locate built app bundles
   - `get_*_bundle_id` tools - Extract bundle IDs

4. **Installation Tools** (depend on built artifacts):
   - `install_app_*` tools - Install built apps
   - `launch_app_*` tools - Launch installed apps

5. **Testing Tools** (depend on projects/schemes):
   - `test_*` tools - Run test suites

6. **UI Automation Tools** (depend on running apps):
   - `snapshot_ui`, `screenshot`, `tap`, etc.

### MANDATORY: Record Key Outputs

Must capture and document these values for dependent tools:
- **Device UUIDs** from `list_devices`
- **Simulator UUIDs** from `list_sims`
- **Project/workspace paths** from `discover_projs`
- **Scheme names** from `list_schems_*`
- **App bundle paths** from `get_*_app_path_*`
- **Bundle IDs** from `get_*_bundle_id`

### Prerequisites

1. **Build the server**: `npm run build`
2. **Install jq**: `brew install jq` (required for JSON parsing)
3. **System Requirements**: macOS with Xcode installed, connected devices/simulators optional

### Step 1: Programmatic Discovery and Official Testing Lists

#### Generate Official Tool List

```bash
# Generate complete tool list with accurate count
npx reloaderoo@latest inspect list-tools -- node build/cli.js mcp 2>/dev/null > /tmp/tools.json

# Get accurate tool count
TOOL_COUNT=$(jq '.tools | length' /tmp/tools.json)
echo "Official tool count: $TOOL_COUNT"

# Generate tool names list for testing checklist
jq -r '.tools[] | .name' /tmp/tools.json > /tmp/tool_names.txt
echo "Tool names saved to /tmp/tool_names.txt"
```

#### Generate Official Resource List

```bash
# Generate complete resource list
npx reloaderoo@latest inspect list-resources -- node build/cli.js mcp 2>/dev/null > /tmp/resources.json

# Get accurate resource count  
RESOURCE_COUNT=$(jq '.resources | length' /tmp/resources.json)
echo "Official resource count: $RESOURCE_COUNT"

# Generate resource URIs for testing checklist
jq -r '.resources[] | .uri' /tmp/resources.json > /tmp/resource_uris.txt
echo "Resource URIs saved to /tmp/resource_uris.txt"
```

#### Create Tool Testing Checklist

```bash
# Generate markdown checklist from actual tool list
echo "# Official Tool Testing Checklist" > /tmp/tool_testing_checklist.md
echo "" >> /tmp/tool_testing_checklist.md
echo "Total Tools: $TOOL_COUNT" >> /tmp/tool_testing_checklist.md
echo "" >> /tmp/tool_testing_checklist.md

# Add each tool as unchecked item
while IFS= read -r tool_name; do
    echo "- [ ] $tool_name" >> /tmp/tool_testing_checklist.md
done < /tmp/tool_names.txt

echo "Tool testing checklist created at /tmp/tool_testing_checklist.md"
```

#### Create Resource Testing Checklist

```bash
# Generate markdown checklist from actual resource list
echo "# Official Resource Testing Checklist" > /tmp/resource_testing_checklist.md
echo "" >> /tmp/resource_testing_checklist.md
echo "Total Resources: $RESOURCE_COUNT" >> /tmp/resource_testing_checklist.md
echo "" >> /tmp/resource_testing_checklist.md

# Add each resource as unchecked item
while IFS= read -r resource_uri; do
    echo "- [ ] $resource_uri" >> /tmp/resource_testing_checklist.md
done < /tmp/resource_uris.txt

echo "Resource testing checklist created at /tmp/resource_testing_checklist.md"
```

### Step 2: Tool Schema Discovery for Parameter Testing

#### Extract Tool Schema Information

```bash
# Get schema for specific tool to understand required parameters
TOOL_NAME="list_devices"
jq --arg tool "$TOOL_NAME" '.tools[] | select(.name == $tool) | .inputSchema' /tmp/tools.json

# Get tool description for usage guidance
jq --arg tool "$TOOL_NAME" '.tools[] | select(.name == $tool) | .description' /tmp/tools.json

# Generate parameter template for tool testing
jq --arg tool "$TOOL_NAME" '.tools[] | select(.name == $tool) | .inputSchema.properties // {}' /tmp/tools.json
```

#### Batch Schema Extraction

```bash
# Create schema reference file for all tools
echo "# Tool Schema Reference" > /tmp/tool_schemas.md
echo "" >> /tmp/tool_schemas.md

while IFS= read -r tool_name; do
    echo "## $tool_name" >> /tmp/tool_schemas.md
    echo "" >> /tmp/tool_schemas.md
    
    # Get description
    description=$(jq -r --arg tool "$tool_name" '.tools[] | select(.name == $tool) | .description' /tmp/tools.json)
    echo "**Description:** $description" >> /tmp/tool_schemas.md
    echo "" >> /tmp/tool_schemas.md
    
    # Get required parameters
    required=$(jq -r --arg tool "$tool_name" '.tools[] | select(.name == $tool) | .inputSchema.required // [] | join(", ")' /tmp/tools.json)
    if [ "$required" != "" ]; then
        echo "**Required Parameters:** $required" >> /tmp/tool_schemas.md
    else
        echo "**Required Parameters:** None" >> /tmp/tool_schemas.md
    fi
    echo "" >> /tmp/tool_schemas.md
    
    # Get all parameters
    echo "**All Parameters:**" >> /tmp/tool_schemas.md
    jq --arg tool "$tool_name" '.tools[] | select(.name == $tool) | .inputSchema.properties // {} | keys[]' /tmp/tools.json | while read param; do
        echo "- $param" >> /tmp/tool_schemas.md
    done
    echo "" >> /tmp/tool_schemas.md
    
done < /tmp/tool_names.txt

echo "Tool schema reference created at /tmp/tool_schemas.md"
```

### Step 3: Manual Tool-by-Tool Testing

#### 🚨 CRITICAL: STEP-BY-STEP BLACK BOX TESTING PROCESS

### ABSOLUTE RULE: ALL TESTING MUST BE DONE MANUALLY, ONE TOOL AT A TIME USING RELOADEROO INSPECT

### SYSTEMATIC TESTING PROCESS

1. **Create TodoWrite Task List**
   - Add all 83 tools to task list before starting
   - Mark each tool as "pending" initially
   - Update status to "in_progress" when testing begins
   - Mark "completed" only after manual verification

2. **Test Each Tool Individually**
   - Execute ONLY via `npx reloaderoo@latest inspect call-tool "TOOL_NAME" --params 'JSON' -- node build/cli.js mcp`
   - Wait for complete response before proceeding to next tool
   - Read and verify each tool's output manually
   - Record key outputs (UUIDs, paths, schemes) for dependent tools

3. **Manual Verification Requirements**
   - ✅ **Read each response** - Manually verify tool output makes sense
   - ✅ **Check for errors** - Identify any tool failures or unexpected responses  
   - ✅ **Record UUIDs/paths** - Save outputs needed for dependent tools
   - ✅ **Update task list** - Mark each tool complete after verification
   - ✅ **Document issues** - Record any problems found during testing

4. **FORBIDDEN SHORTCUTS:**
   - ❌ **NO SCRIPTS** - Scripts hide what's happening and prevent proper verification
   - ❌ **NO AUTOMATION** - Every tool call must be manually executed and verified
   - ❌ **NO BATCHING** - Cannot test multiple tools simultaneously
   - ❌ **NO MCP DIRECT CALLS** - Only Reloaderoo inspect commands allowed

#### Phase 1: Infrastructure Validation

#### Manual Commands (execute individually):

```bash
# Test server connectivity
npx reloaderoo@latest inspect ping -- node build/cli.js mcp

# Get server information  
npx reloaderoo@latest inspect server-info -- node build/cli.js mcp

# Verify tool count manually
npx reloaderoo@latest inspect list-tools -- node build/cli.js mcp 2>/dev/null | jq '.tools | length'

# Verify resource count manually
npx reloaderoo@latest inspect list-resources -- node build/cli.js mcp 2>/dev/null | jq '.resources | length'
```

#### Phase 2: Resource Testing

```bash
# Test each resource systematically
while IFS= read -r resource_uri; do
    echo "Testing resource: $resource_uri"
    npx reloaderoo@latest inspect read-resource "$resource_uri" -- node build/cli.js mcp 2>/dev/null
    echo "---"
done < /tmp/resource_uris.txt
```

#### Phase 3: Foundation Tools (Data Collection)

### CRITICAL: Capture ALL key outputs for dependent tools

```bash
echo "=== FOUNDATION TOOL TESTING & DATA COLLECTION ==="

# 1. Test doctor (no dependencies)
echo "Testing doctor..."
npx reloaderoo@latest inspect call-tool "doctor" --params '{}' -- node build/cli.js mcp 2>/dev/null

# 2. Collect device data
echo "Collecting device UUIDs..."
npx reloaderoo@latest inspect call-tool "list_devices" --params '{}' -- node build/cli.js mcp 2>/dev/null > /tmp/devices_output.json
DEVICE_UUIDS=$(jq -r '.content[0].text' /tmp/devices_output.json | grep -E "UDID: [A-F0-9-]+" | sed 's/.*UDID: //' | head -2)
echo "Device UUIDs captured: $DEVICE_UUIDS"

# 3. Collect simulator data  
echo "Collecting simulator UUIDs..."
npx reloaderoo@latest inspect call-tool "list_sims" --params '{}' -- node build/cli.js mcp 2>/dev/null > /tmp/sims_output.json
SIMULATOR_UUIDS=$(jq -r '.content[0].text' /tmp/sims_output.json | grep -E "\([A-F0-9-]+\)" | sed 's/.*(\([A-F0-9-]*\)).*/\1/' | head -3)
echo "Simulator UUIDs captured: $SIMULATOR_UUIDS"

# 4. Collect project data
echo "Collecting project paths..."
npx reloaderoo@latest inspect call-tool "discover_projs" --params '{"workspaceRoot": "/Volumes/Developer/XcodeBuildMCP"}' -- node build/cli.js mcp 2>/dev/null > /tmp/projects_output.json
PROJECT_PATHS=$(jq -r '.content[1].text' /tmp/projects_output.json | grep -E "\.xcodeproj$" | sed 's/.*- //' | head -3)
WORKSPACE_PATHS=$(jq -r '.content[2].text' /tmp/projects_output.json | grep -E "\.xcworkspace$" | sed 's/.*- //' | head -2)
echo "Project paths captured: $PROJECT_PATHS"
echo "Workspace paths captured: $WORKSPACE_PATHS"

# Save key data for dependent tools
echo "$DEVICE_UUIDS" > /tmp/device_uuids.txt
echo "$SIMULATOR_UUIDS" > /tmp/simulator_uuids.txt  
echo "$PROJECT_PATHS" > /tmp/project_paths.txt
echo "$WORKSPACE_PATHS" > /tmp/workspace_paths.txt
```

#### Phase 4: Discovery Tools (Metadata Collection)

```bash
echo "=== DISCOVERY TOOL TESTING & METADATA COLLECTION ==="

# Collect schemes for each project
while IFS= read -r project_path; do
    if [ -n "$project_path" ]; then
        echo "Getting schemes for: $project_path"
        npx reloaderoo@latest inspect call-tool "list_schems_proj" --params "{\"projectPath\": \"$project_path\"}" -- node build/cli.js mcp 2>/dev/null > /tmp/schemes_$$.json
        SCHEMES=$(jq -r '.content[1].text' /tmp/schemes_$$.json 2>/dev/null || echo "NoScheme")
        echo "$project_path|$SCHEMES" >> /tmp/project_schemes.txt
        echo "Schemes captured for $project_path: $SCHEMES"
    fi
done < /tmp/project_paths.txt

# Collect schemes for each workspace
while IFS= read -r workspace_path; do
    if [ -n "$workspace_path" ]; then
        echo "Getting schemes for: $workspace_path"
        npx reloaderoo@latest inspect call-tool "list_schemes" --params "{\"workspacePath\": \"$workspace_path\"}" -- node build/cli.js mcp 2>/dev/null > /tmp/ws_schemes_$$.json
        SCHEMES=$(jq -r '.content[1].text' /tmp/ws_schemes_$$.json 2>/dev/null || echo "NoScheme")
        echo "$workspace_path|$SCHEMES" >> /tmp/workspace_schemes.txt
        echo "Schemes captured for $workspace_path: $SCHEMES"
    fi
done < /tmp/workspace_paths.txt
```

#### Phase 5: Manual Individual Tool Testing (All 83 Tools)

### CRITICAL: Test every single tool manually, one at a time

#### Manual Testing Process:

1. **Create task list** with TodoWrite tool for all 83 tools
2. **Test each tool individually** with proper parameters
3. **Mark each tool complete** in task list after manual verification
4. **Record results** and observations for each tool
5. **NO SCRIPTS** - Each command executed manually

### STEP-BY-STEP MANUAL TESTING COMMANDS

```bash
# STEP 1: Test foundation tools (no parameters required)
# Execute each command individually, wait for response, verify manually
npx reloaderoo@latest inspect call-tool "doctor" --params '{}' -- node build/cli.js mcp
# [Wait for response, read output, mark tool complete in task list]

npx reloaderoo@latest inspect call-tool "list_devices" --params '{}' -- node build/cli.js mcp
# [Record device UUIDs from response for dependent tools]

npx reloaderoo@latest inspect call-tool "list_sims" --params '{}' -- node build/cli.js mcp
# [Record simulator UUIDs from response for dependent tools]

# STEP 2: Test project discovery (use discovered project paths)
npx reloaderoo@latest inspect call-tool "list_schems_proj" --params '{"projectPath": "/actual/path/from/discover_projs.xcodeproj"}' -- node build/cli.js mcp
# [Record scheme names from response for build tools]

# STEP 3: Test workspace tools (use discovered workspace paths)  
npx reloaderoo@latest inspect call-tool "list_schemes" --params '{"workspacePath": "/actual/path/from/discover_projs.xcworkspace"}' -- node build/cli.js mcp
# [Record scheme names from response for build tools]

# STEP 4: Test simulator tools (use captured simulator UUIDs from step 1)
npx reloaderoo@latest inspect call-tool "boot_sim" --params '{"simulatorUuid": "ACTUAL_UUID_FROM_LIST_SIMS"}' -- node build/cli.js mcp
# [Verify simulator boots successfully]

# STEP 5: Test build tools (requires project + scheme + simulator from previous steps)
npx reloaderoo@latest inspect call-tool "build_sim_id_proj" --params '{"projectPath": "/actual/project.xcodeproj", "scheme": "ActualSchemeName", "simulatorId": "ACTUAL_SIMULATOR_UUID"}' -- node build/cli.js mcp
# [Verify build succeeds and record app bundle path]
```

### CRITICAL: EACH COMMAND MUST BE
1. **Executed individually** - One command at a time, manually typed or pasted
2. **Verified manually** - Read the complete response before continuing
3. **Tracked in task list** - Mark tool complete only after verification
4. **Use real data** - Replace placeholder values with actual captured data
5. **Wait for completion** - Allow each command to finish before proceeding

### TESTING VIOLATIONS AND ENFORCEMENT

### 🚨 CRITICAL VIOLATIONS THAT WILL TERMINATE TESTING

1. **Direct MCP Tool Usage Violation:**
   ```typescript
   // ❌ IMMEDIATE TERMINATION - Using MCP tools directly
   await mcp__XcodeBuildMCP__list_devices();
   const result = await list_sims();
   ```

2. **Script-Based Testing Violation:**
   ```bash
   # ❌ IMMEDIATE TERMINATION - Using scripts to test tools
   for tool in $(cat tool_list.txt); do
     npx reloaderoo inspect call-tool "$tool" --params '{}' -- node build/cli.js mcp
   done
   ```

3. **Batching/Automation Violation:**
   ```bash
   # ❌ IMMEDIATE TERMINATION - Testing multiple tools simultaneously
   npx reloaderoo inspect call-tool "list_devices" & npx reloaderoo inspect call-tool "list_sims" &
   ```

4. **Source Code Examination Violation:**
   ```typescript
   // ❌ IMMEDIATE TERMINATION - Reading implementation during testing
   const toolImplementation = await Read('/src/mcp/tools/device-shared/list_devices.ts');
   ```

### ENFORCEMENT PROCEDURE
1. **First Violation**: Immediate correction and restart of testing process
2. **Documentation Update**: Add explicit prohibition to prevent future violations  
3. **Method Validation**: Ensure all future testing uses only Reloaderoo inspect commands
4. **Progress Reset**: Restart testing from foundation tools if direct MCP usage detected

### VALID TESTING SEQUENCE EXAMPLE
```bash
# ✅ CORRECT - Step-by-step manual execution via Reloaderoo
# Tool 1: Test doctor
npx reloaderoo@latest inspect call-tool "doctor" --params '{}' -- node build/cli.js mcp
# [Read response, verify, mark complete in TodoWrite]

# Tool 2: Test list_devices  
npx reloaderoo@latest inspect call-tool "list_devices" --params '{}' -- node build/cli.js mcp
# [Read response, capture UUIDs, mark complete in TodoWrite]

# Tool 3: Test list_sims
npx reloaderoo@latest inspect call-tool "list_sims" --params '{}' -- node build/cli.js mcp
# [Read response, capture UUIDs, mark complete in TodoWrite]

# Tool X: Test stateful tool (expected to fail)
npx reloaderoo@latest inspect call-tool "swift_package_stop" --params '{"pid": 12345}' -- node build/cli.js mcp
# [Tool fails as expected - no in-memory state available]
# [Mark as "false negative - stateful tool limitation" in TodoWrite]
# [Continue to next tool without investigation]

# Continue individually for all 83 tools...
```

### HANDLING STATEFUL TOOL FAILURES
```bash
# ✅ CORRECT Response to Expected Stateful Tool Failure
# Tool fails with "No process found" or similar state-related error
# Response: Mark tool as "tested - false negative (stateful)" in task list
# Do NOT attempt to diagnose, fix, or investigate the failure
# Continue immediately to next tool in sequence
```

### Step 4: Error Testing

```bash
# Test error handling systematically
echo "=== Error Testing ==="

# Test with invalid JSON parameters
echo "Testing invalid parameter types..."
npx reloaderoo@latest inspect call-tool list_schems_proj --params '{"projectPath": 123}' -- node build/cli.js mcp 2>/dev/null

# Test with non-existent paths
echo "Testing non-existent paths..."
npx reloaderoo@latest inspect call-tool list_schems_proj --params '{"projectPath": "/nonexistent/path.xcodeproj"}' -- node build/cli.js mcp 2>/dev/null

# Test with invalid UUIDs
echo "Testing invalid UUIDs..."
npx reloaderoo@latest inspect call-tool boot_sim --params '{"simulatorUuid": "invalid-uuid"}' -- node build/cli.js mcp 2>/dev/null
```

### Step 5: Generate Testing Report

```bash
# Create comprehensive testing session report
cat > TESTING_SESSION_$(date +%Y-%m-%d).md << EOF
# Manual Testing Session - $(date +%Y-%m-%d)

## Environment
- macOS Version: $(sw_vers -productVersion)
- XcodeBuildMCP Version: $(jq -r '.version' package.json 2>/dev/null || echo "unknown")
- Testing Method: Reloaderoo @latest via npx

## Official Counts (Programmatically Verified)
- Total Tools: $TOOL_COUNT
- Total Resources: $RESOURCE_COUNT

## Test Results
[Document test results here]

## Issues Found
[Document any discrepancies or failures]

## Performance Notes
[Document response times and performance observations]
EOF

echo "Testing session template created: TESTING_SESSION_$(date +%Y-%m-%d).md"
```

### Key Commands Reference

```bash
# Essential testing commands
npx reloaderoo@latest inspect ping -- node build/cli.js mcp
npx reloaderoo@latest inspect server-info -- node build/cli.js mcp
npx reloaderoo@latest inspect list-tools -- node build/cli.js mcp | jq '.tools | length'
npx reloaderoo@latest inspect list-resources -- node build/cli.js mcp | jq '.resources | length'
npx reloaderoo@latest inspect call-tool TOOL_NAME --params '{}' -- node build/cli.js mcp
npx reloaderoo@latest inspect read-resource "xcodebuildmcp://RESOURCE" -- node build/cli.js mcp

# Schema extraction
jq --arg tool "TOOL_NAME" '.tools[] | select(.name == $tool) | .inputSchema' /tmp/tools.json
jq --arg tool "TOOL_NAME" '.tools[] | select(.name == $tool) | .description' /tmp/tools.json
```

This systematic approach ensures comprehensive, accurate testing using programmatic discovery and validation of all XcodeBuildMCP functionality.

## Troubleshooting

### Common Issues

#### 1. "Noop Executor Called" Error
**Symptoms**: Test fails with `NOOP EXECUTOR CALLED` or `NOOP FILESYSTEM EXECUTOR CALLED`
**Cause**: The Vitest unit setup (`src/test-utils/vitest-executor-safety.setup.ts`) installs
blocking noop overrides for all unit tests. If a handler calls `getDefaultCommandExecutor()` or
`getDefaultFileSystemExecutor()` without an explicit test override, the noop throws.
**Fix**: Either inject a mock executor directly into the logic function, or use the override hooks:

```typescript
// Option A: Direct injection into the logic function
const mockExecutor = createMockExecutor({ success: true });
const result = await toolLogic(params, mockExecutor);

// Option B: Override hooks (for handler-level tests)
import { __setTestCommandExecutorOverride } from '../utils/command.ts';
__setTestCommandExecutorOverride(createMockExecutor({ success: true }));
const result = await handler(params);
```

**Note**: The setup file only applies to `vitest.config.ts` (unit tests). Snapshot and smoke
tests use separate configs and are not affected.

#### 2. "Noop Interactive Spawner Called" Error
**Symptoms**: Test fails with `NOOP INTERACTIVE SPAWNER CALLED`
**Cause**: Same mechanism as above but for `getDefaultInteractiveSpawner()`.
**Fix**: Use `createMockInteractiveSpawner()` from `test-utils/mock-executors.ts`.

#### 3. Handler Signature Errors
**Symptoms**: TypeScript errors about handler parameters
**Cause**: Handler doesn't support dependency injection
**Fix**: Update handler signature:

```typescript
async handler(args: Record<string, unknown>): Promise<ToolResponse> {
  return tool_nameLogic(args, getDefaultCommandExecutor(), getDefaultFileSystemExecutor());
}
```

### Debug Commands

```bash
# Run specific test file
npm test -- src/plugins/simulator-workspace/__tests__/tool_name.test.ts

# Run with verbose output
npm test -- --reporter=verbose

# Check for banned patterns
node scripts/check-code-patterns.js

# Verify dependency injection compliance
node scripts/audit-dependency-container.js

# Coverage for specific directory
npm run test:coverage -- src/plugins/simulator-workspace/
```

### Validation Scripts

```bash
# Check for architectural pattern violations
node scripts/check-code-patterns.js

# Check dependency injection compliance
node scripts/audit-dependency-container.js

# Both scripts must pass before committing
```

## Best Practices Summary

1. **Dependency injection**: Always use createMockExecutor() and createMockFileSystemExecutor()
2. **External boundaries via DI**: mock command execution/filesystem with injected executors
3. **Three dimensions**: Test input validation, command execution, and output processing
4. **Literal expectations**: Use exact strings in assertions to catch regressions
5. **Performance**: Ensure fast execution through proper mocking
6. **Coverage**: Aim for 95%+ with focus on error paths
7. **Consistency**: Follow standard patterns across all plugin tests
8. **Test safety**: Default executors prevent accidental real system calls

This testing strategy ensures robust, maintainable tests that provide confidence in plugin functionality while remaining resilient to implementation changes and keeping external boundaries deterministic.
