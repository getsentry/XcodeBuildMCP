/**
 * Common type definitions used across the server
 *
 * This module provides core type definitions and interfaces used throughout the codebase.
 * It establishes a consistent type system for platform identification, tool responses,
 * and other shared concepts.
 *
 * Responsibilities:
 * - Defining the XcodePlatform enum for platform identification
 * - Establishing the ToolResponse interface for standardized tool outputs
 * - Providing ToolResponseContent types for different response formats
 * - Supporting error handling with standardized error response types
 */

/**
 * Represents a suggested next step that can be rendered for CLI or MCP.
 */
export interface NextStep {
  /** Optional MCP tool name (e.g., "boot_sim") */
  tool?: string;
  /** CLI tool name (kebab-case, disambiguated) */
  cliTool?: string;
  /** Workflow name for CLI grouping (e.g., "simulator") */
  workflow?: string;
  /** Human-readable description of the action (optional when manifest template provides it) */
  label?: string;
  /** Optional parameters to pass to the tool */
  params?: Record<string, string | number | boolean>;
  /** Optional ordering hint for merged steps */
  priority?: number;
  /** When to show this step: 'always' (default), 'success', or 'failure' */
  when?: 'always' | 'success' | 'failure';
}

export type NextStepParams = Record<string, string | number | boolean>;
export type NextStepParamsMap = Record<string, NextStepParams | NextStepParams[]>;

/**
 * Output style controls verbosity of tool responses.
 * - 'normal': Full output including next steps
 * - 'minimal': Essential result only, no next steps
 */
export type OutputStyle = 'normal' | 'minimal';

/**
 * Enum representing Xcode build platforms.
 */
export enum XcodePlatform {
  macOS = 'macOS',
  iOS = 'iOS',
  iOSSimulator = 'iOS Simulator',
  watchOS = 'watchOS',
  watchOSSimulator = 'watchOS Simulator',
  tvOS = 'tvOS',
  tvOSSimulator = 'tvOS Simulator',
  visionOS = 'visionOS',
  visionOSSimulator = 'visionOS Simulator',
}

/**
 * ToolResponse - Standard response format for tools
 * Compatible with MCP CallToolResult interface from the SDK
 */
export interface ToolResponse {
  content: ToolResponseContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
  /** Structured next steps that get rendered differently for CLI vs MCP */
  nextSteps?: NextStep[];
  /** Dynamic params for manifest nextSteps keyed by toolId */
  nextStepParams?: NextStepParamsMap;
  [key: string]: unknown; // Index signature to match CallToolResult
}

/**
 * Contents that can be included in a tool response
 */
export type ToolResponseContent =
  | {
      type: 'text';
      text: string;
      [key: string]: unknown; // Index signature to match ContentItem
    }
  | {
      type: 'image';
      data: string; // Base64-encoded image data (without URI scheme prefix)
      mimeType: string; // e.g., 'image/png', 'image/jpeg'
      [key: string]: unknown; // Index signature to match ContentItem
    };

export function createTextContent(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

export function createImageContent(
  data: string,
  mimeType: string,
): { type: 'image'; data: string; mimeType: string } {
  return { type: 'image', data, mimeType };
}

/**
 * ValidationResult - Result of parameter validation operations
 */
export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

/**
 * CommandResponse - Generic result of command execution
 */
export interface CommandResponse {
  success: boolean;
  output: string;
  error?: string;
  process?: unknown; // ChildProcess from node:child_process
}

/**
 * Interface for shared build parameters
 */
export interface SharedBuildParams {
  workspacePath?: string;
  projectPath?: string;
  scheme: string;
  configuration: string;
  derivedDataPath?: string;
  extraArgs?: string[];
}

/**
 * Interface for platform-specific build options
 */
export interface PlatformBuildOptions {
  platform: XcodePlatform;
  simulatorName?: string;
  simulatorId?: string;
  deviceId?: string;
  useLatestOS?: boolean;
  packageCachePath?: string;
  arch?: string;
  logPrefix: string;
  packageCachePath?: string;
}
