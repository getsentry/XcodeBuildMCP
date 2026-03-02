/**
 * Tests for test_sim plugin (session-aware version)
 * Follows CLAUDE.md guidance: dependency injection, no vi-mocks, literal validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, test_simLogic } from '../test_sim.ts';

describe('test_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only non-session fields in public schema', () => {
      const schemaObj = z.strictObject(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(
        schemaObj.safeParse({
          extraArgs: ['--quiet'],
          testRunnerEnv: { FOO: 'BAR' },
        }).success,
      ).toBe(true);

      expect(schemaObj.safeParse({ derivedDataPath: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ extraArgs: ['--ok', 42] }).success).toBe(false);
      expect(schemaObj.safeParse({ preferXcodebuild: true }).success).toBe(false);
      expect(schemaObj.safeParse({ testRunnerEnv: { FOO: 123 } }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs', 'testRunnerEnv'].sort());
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace when scheme default exists', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should require simulator identifier when scheme and project defaults exist', async () => {
      sessionStore.setDefaults({
        scheme: 'MyScheme',
        projectPath: '/path/to/project.xcodeproj',
      });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide simulatorId or simulatorName');
    });

    it('should error when both simulatorId and simulatorName provided explicitly', async () => {
      sessionStore.setDefaults({
        scheme: 'MyScheme',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      const result = await handler({
        simulatorId: 'SIM-UUID',
        simulatorName: 'iPhone 17',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('simulatorId');
      expect(result.content[0].text).toContain('simulatorName');
    });
  });
});
