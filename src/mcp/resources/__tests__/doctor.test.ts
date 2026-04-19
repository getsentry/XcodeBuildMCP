import { describe, it, expect } from 'vitest';

import { doctorResourceLogic } from '../doctor.ts';
import { createMockExecutor } from '../../../test-utils/mock-executors.ts';

describe('doctor resource', () => {
  describe('Handler Functionality', () => {
    it('should handle successful environment data retrieval', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock command output',
      });

      const result = await doctorResourceLogic(mockExecutor);
      const text = result.contents.map((c) => c.text).join('\n');

      expect(result.contents).toHaveLength(1);
      expect(text).toContain('Doctor');
      expect(text).toContain('Node.js Information');
      expect(text).toContain('Dependencies');
      expect(text).toContain('Environment Variables');
    });

    it('should handle spawn errors by showing doctor info', async () => {
      const mockExecutor = createMockExecutor(new Error('spawn xcrun ENOENT'));

      const result = await doctorResourceLogic(mockExecutor);
      const text = result.contents.map((c) => c.text).join('\n');

      expect(result.contents).toHaveLength(1);
      expect(text).toContain('Doctor');
      expect(text).toContain('spawn xcrun ENOENT');
    });

    it('should include required doctor sections', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock output',
      });

      const result = await doctorResourceLogic(mockExecutor);
      const text = result.contents.map((c) => c.text).join('\n');

      expect(text).toContain('Troubleshooting Tips');
      expect(text).toContain('brew tap cameroncooke/axe');
      expect(text).toContain('INCREMENTAL_BUILDS_ENABLED=1');
    });

    it('should provide feature status information', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock output',
      });

      const result = await doctorResourceLogic(mockExecutor);
      const text = result.contents.map((c) => c.text).join('\n');

      expect(text).toContain('UI Automation (axe)');
      expect(text).toContain('Incremental Builds');
      expect(text).toContain('Mise Integration');
      expect(text).toContain('Tool Availability Summary');
    });

    it('should handle error conditions gracefully', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Command failed',
      });

      const result = await doctorResourceLogic(mockExecutor);
      const text = result.contents.map((c) => c.text).join('\n');

      expect(result.contents).toHaveLength(1);
      expect(text).toContain('Doctor');
    });
  });
});
