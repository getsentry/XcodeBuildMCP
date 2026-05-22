import { describe, expect, it } from 'vitest';

import { loadManifest } from '../manifest/load-manifest.ts';

const runtimeSnapshotMutatingUiTools = ['button', 'gesture'] as const;

describe('UI automation routing manifests', () => {
  it('routes tools that refresh runtime snapshots through the daemon-backed state store', () => {
    const manifest = loadManifest();

    for (const toolId of runtimeSnapshotMutatingUiTools) {
      const tool = manifest.tools.get(toolId);

      expect(tool, `${toolId} manifest should exist`).toBeDefined();
      expect(tool?.routing?.stateful, `${toolId} must use daemon-backed state`).toBe(true);
    }
  });
});
