import { describe, expect, it } from 'vitest';
import { resolveFilePathRenderStyle } from '../file-path-render-style.ts';

describe('resolveFilePathRenderStyle', () => {
  it('uses explicit render style before configured and output-style defaults', () => {
    expect(
      resolveFilePathRenderStyle({
        explicit: 'tree',
        configured: 'list',
        outputStyle: 'normal',
      }),
    ).toBe('tree');
  });

  it('uses configured render style before minimal output-style defaults', () => {
    expect(
      resolveFilePathRenderStyle({
        configured: 'list',
        outputStyle: 'minimal',
      }),
    ).toBe('list');
  });

  it('defaults minimal output to tree and normal output to list', () => {
    expect(resolveFilePathRenderStyle({ outputStyle: 'minimal' })).toBe('tree');
    expect(resolveFilePathRenderStyle({ outputStyle: 'normal' })).toBe('list');
  });
});
