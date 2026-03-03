/**
 * Tests for consolidateContentForClaudeCode
 *
 * Exercises the consolidation path by injecting a mock EnvironmentDetector
 * that reports Claude Code as active, bypassing the production guard that
 * disables consolidation during tests.
 */
import { describe, it, expect } from 'vitest';
import { consolidateContentForClaudeCode } from '../validation.ts';
import { createMockEnvironmentDetector } from '../../test-utils/mock-executors.ts';
import type { ToolResponse } from '../../types/common.ts';

const claudeCodeDetector = createMockEnvironmentDetector({ isRunningUnderClaudeCode: true });
const nonClaudeCodeDetector = createMockEnvironmentDetector({ isRunningUnderClaudeCode: false });

describe('consolidateContentForClaudeCode', () => {
  describe('when Claude Code is detected', () => {
    it('should consolidate multiple text blocks into one', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'Block 1' },
          { type: 'text', text: 'Block 2' },
          { type: 'text', text: 'Block 3' },
        ],
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Block 1\n---\nBlock 2\n---\nBlock 3',
      );
    });

    it('should return single-block responses unchanged', () => {
      const response: ToolResponse = {
        content: [{ type: 'text', text: 'Only block' }],
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result).toBe(response);
    });

    it('should return empty content unchanged', () => {
      const response: ToolResponse = { content: [] };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result).toBe(response);
    });

    it('should preserve isError flag', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'Error A' },
          { type: 'text', text: 'Error B' },
        ],
        isError: true,
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
    });

    it('should skip non-text content blocks and return original when no text found', () => {
      const response: ToolResponse = {
        content: [
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
          { type: 'image', data: 'base64data2', mimeType: 'image/jpeg' },
        ],
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result).toBe(response);
    });

    it('should consolidate only text blocks when mixed with image blocks', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'Text A' },
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
          { type: 'text', text: 'Text B' },
        ],
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Text A\n---\nText B',
      );
    });

    it('should add separators only between text blocks, not before first', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).not.toMatch(/^---/);
      expect(text).toBe('First\n---\nSecond');
    });

    it('should preserve extra properties on the response', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
        ],
        _meta: { foo: 'bar' },
      };

      const result = consolidateContentForClaudeCode(response, claudeCodeDetector);

      expect(result._meta).toEqual({ foo: 'bar' });
      expect(result.content).toHaveLength(1);
    });
  });

  describe('when Claude Code is NOT detected', () => {
    it('should return multi-block responses unchanged', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'Block 1' },
          { type: 'text', text: 'Block 2' },
        ],
      };

      const result = consolidateContentForClaudeCode(response, nonClaudeCodeDetector);

      expect(result).toBe(response);
      expect(result.content).toHaveLength(2);
    });

    it('should return single-block responses unchanged', () => {
      const response: ToolResponse = {
        content: [{ type: 'text', text: 'Only block' }],
      };

      const result = consolidateContentForClaudeCode(response, nonClaudeCodeDetector);

      expect(result).toBe(response);
    });
  });

  describe('without explicit detector (default behavior)', () => {
    it('should use default detector and not consolidate in test env', () => {
      const response: ToolResponse = {
        content: [
          { type: 'text', text: 'Block 1' },
          { type: 'text', text: 'Block 2' },
        ],
      };

      const result = consolidateContentForClaudeCode(response);

      expect(result).toBe(response);
      expect(result.content).toHaveLength(2);
    });
  });
});
