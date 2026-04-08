import { describe, expect, it } from 'vitest';
import { formatToolList } from '../output.ts';

describe('formatToolList', () => {
  it('formats ungrouped tool list', () => {
    const tools = [
      { cliName: 'build', workflow: 'xcode', description: 'Build project', stateful: false },
      { cliName: 'test', workflow: 'xcode', description: 'Run tests', stateful: true },
    ];
    const output = formatToolList(tools);
    expect(output).toContain('xcode build');
    expect(output).toContain('xcode test');
    expect(output).toContain('[stateful]');
  });
});
