import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ToolSchemaShape } from '../core/plugin-types.ts';
import type { RenderSession, ToolHandlerContext } from '../rendering/types.ts';

export interface NextStepTemplate {
  label: string;
  toolId?: string;
  params?: Record<string, string | number | boolean>;
  priority?: number;
  when?: 'always' | 'success' | 'failure';
}

export type RuntimeKind = 'cli' | 'daemon' | 'mcp';

export interface ToolDefinition {
  /** Stable manifest tool id for static tools loaded from YAML */
  id?: string;

  /** Stable CLI command name (kebab-case, disambiguated) */
  cliName: string;

  /** Original MCP tool name as declared (unchanged) */
  mcpName: string;

  /** Workflow directory name (e.g., "simulator", "device", "logging") */
  workflow: string;

  description?: string;
  annotations?: ToolAnnotations;

  /** Static next-step templates declared in the manifest */
  nextStepTemplates?: NextStepTemplate[];

  /**
   * Schema shape used to generate yargs flags for CLI.
   * Must include ALL parameters (not the session-default-hidden version).
   */
  cliSchema: ToolSchemaShape;

  /**
   * Schema shape used for MCP registration.
   */
  mcpSchema: ToolSchemaShape;

  /**
   * Whether CLI MUST route this tool to the daemon (stateful operations).
   */
  stateful: boolean;

  /**
   * For daemon-backed xcode-ide dynamic tools, identifies the remote bridge tool.
   */
  xcodeIdeRemoteToolName?: string;

  /**
   * Shared handler (same used by MCP). No duplication.
   */
  handler: (params: Record<string, unknown>, ctx: ToolHandlerContext) => Promise<void>;
}

export interface ToolResolution {
  tool?: ToolDefinition;
  ambiguous?: string[];
  notFound?: boolean;
}

export interface ToolCatalog {
  tools: ToolDefinition[];

  /** Exact match on cliName */
  getByCliName(name: string): ToolDefinition | null;

  /** Exact match on MCP name */
  getByMcpName(name: string): ToolDefinition | null;

  /** Exact match on stable manifest tool id */
  getByToolId(toolId: string): ToolDefinition | null;

  /** Resolve user input with ambiguity reporting */
  resolve(input: string): ToolResolution;
}

export interface InvokeOptions {
  runtime: RuntimeKind;
  renderSession?: RenderSession;
  /** Pre-created handler context; if provided, executeTool uses it instead of creating a new one. */
  handlerContext?: ToolHandlerContext;
  /** CLI-exposed workflow IDs used for daemon environment overrides */
  cliExposedWorkflowIds?: string[];
  /** @deprecated Use cliExposedWorkflowIds instead */
  enabledWorkflows?: string[];
  /** Socket path override */
  socketPath?: string;
  /** Timeout in ms for daemon startup when auto-starting (default: 5000) */
  daemonStartupTimeoutMs?: number;
  /** Workspace root for daemon auto-start context */
  workspaceRoot?: string;
  /** Log level override for daemon auto-start */
  logLevel?: string;
}

export interface ToolInvoker {
  invoke(toolName: string, args: Record<string, unknown>, opts: InvokeOptions): Promise<void>;
}
