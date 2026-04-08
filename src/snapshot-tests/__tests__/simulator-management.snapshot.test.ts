import { execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness, ensureSimulatorBooted } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';
import { list_simsLogic } from '../../mcp/tools/simulator/list_sims.ts';
import { normalizeSnapshotOutput } from '../normalize.ts';
import { loadManifest } from '../../core/manifest/load-manifest.ts';
import { getEffectiveCliName } from '../../core/manifest/schema.ts';
import { createToolCatalog } from '../../runtime/tool-catalog.ts';
import { postProcessSession } from '../../runtime/tool-invoker.ts';
import type { ToolDefinition } from '../../runtime/types.ts';
import { createRenderSession } from '../../rendering/render.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import { handlerContextStorage } from '../../utils/typed-tool-factory.ts';

const FIXTURE_SIMCTL_TEXT = `== Devices ==
-- iOS 26.4 --
    iPhone 17 Pro (11111111-1111-1111-1111-111111111111) (Shutdown)
    iPhone 17 Pro Max (22222222-2222-2222-2222-222222222222) (Shutdown)
    iPhone 17e (33333333-3333-3333-3333-333333333333) (Shutdown)
    iPhone Air (44444444-4444-4444-4444-444444444444) (Shutdown)
    iPhone 17 (55555555-5555-5555-5555-555555555555) (Booted)
    iPad Pro 13-inch (M5) (66666666-6666-6666-6666-666666666666) (Shutdown)
    iPad Pro 11-inch (M5) (77777777-7777-7777-7777-777777777777) (Shutdown)
    iPad mini (A17 Pro) (88888888-8888-8888-8888-888888888888) (Shutdown)
    iPad Air 13-inch (M4) (99999999-9999-9999-9999-999999999999) (Shutdown)
    iPad Air 11-inch (M4) (AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA) (Shutdown)
    iPad (A16) (BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB) (Shutdown)
-- iOS 26.2 --
    iPhone 17 Pro (CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC) (Shutdown)
    iPhone 17 Pro Max (DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD) (Shutdown)
    iPhone Air (EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE) (Shutdown)
    iPhone 17 (FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF) (Shutdown)
    iPhone 16e (12121212-1212-1212-1212-121212121212) (Shutdown)
    iPad Pro 13-inch (M5) (13131313-1313-1313-1313-131313131313) (Shutdown)
    iPad Pro 11-inch (M5) (14141414-1414-1414-1414-141414141414) (Shutdown)
    iPad mini (A17 Pro) (15151515-1515-1515-1515-151515151515) (Shutdown)
    iPad (A16) (16161616-1616-1616-1616-161616161616) (Shutdown)
    iPad Air 13-inch (M3) (17171717-1717-1717-1717-171717171717) (Shutdown)
    iPad Air 11-inch (M3) (18181818-1818-1818-1818-181818181818) (Shutdown)
-- xrOS 26.2 --
    Apple Vision Pro (19191919-1919-1919-1919-191919191919) (Shutdown)
-- watchOS 26.2 --
    Apple Watch Series 11 (46mm) (20202020-2020-2020-2020-202020202020) (Shutdown)
    Apple Watch Series 11 (42mm) (21212121-2121-2121-2121-212121212121) (Shutdown)
    Apple Watch Ultra 3 (49mm) (23232323-2323-2323-2323-232323232323) (Shutdown)
    Apple Watch SE 3 (44mm) (24242424-2424-2424-2424-242424242424) (Shutdown)
    Apple Watch SE 3 (40mm) (25252525-2525-2525-2525-252525252525) (Shutdown)
-- tvOS 26.2 --
    Apple TV 4K (3rd generation) (26262626-2626-2626-2626-262626262626) (Shutdown)
    Apple TV 4K (3rd generation) (at 1080p) (27272727-2727-2727-2727-272727272727) (Shutdown)
    Apple TV (28282828-2828-2828-2828-282828282828) (Shutdown)`;

function buildCatalogForTool(toolId: string, handler: ToolDefinition['handler']) {
  const manifest = loadManifest();
  const manifestEntry = manifest.tools.get(toolId);
  if (!manifestEntry) {
    throw new Error(`Tool manifest not found: ${toolId}`);
  }

  const noopHandler: ToolDefinition['handler'] = async () => {};
  const allTools: ToolDefinition[] = Array.from(manifest.tools.values()).map((toolEntry) => ({
    id: toolEntry.id,
    cliName: getEffectiveCliName(toolEntry),
    mcpName: toolEntry.names.mcp,
    workflow: '',
    description: toolEntry.description,
    nextStepTemplates: toolEntry.nextSteps,
    mcpSchema: {} as ToolDefinition['mcpSchema'],
    cliSchema: {} as ToolDefinition['cliSchema'],
    stateful: toolEntry.routing?.stateful ?? false,
    handler: toolEntry.id === manifestEntry.id ? handler : noopHandler,
  }));

  const catalog = createToolCatalog(allTools);
  const tool = catalog.getByToolId(toolId);
  if (!tool) {
    throw new Error(`Tool catalog entry not found: ${toolId}`);
  }

  return { tool, catalog };
}

async function invokeDeterministicSimulatorList(): Promise<{ text: string; isError: boolean }> {
  const executor = async (command: string[]) => {
    if (command.includes('--json')) {
      return {
        success: true,
        output: 'not-json',
        error: undefined,
        process: { pid: 0 } as never,
      };
    }

    return {
      success: true,
      output: FIXTURE_SIMCTL_TEXT,
      error: undefined,
      process: { pid: 0 } as never,
    };
  };

  const session = createRenderSession('text');
  const ctx: ToolHandlerContext = {
    emit: (event) => session.emit(event),
    attach: () => {},
  };
  await handlerContextStorage.run(ctx, () => list_simsLogic({ enabled: true }, executor));

  const { tool, catalog } = buildCatalogForTool(
    'list_sims',
    list_simsLogic as unknown as ToolDefinition['handler'],
  );
  postProcessSession({
    tool,
    session,
    ctx,
    catalog,
    runtime: 'mcp',
    applyTemplateNextSteps: false,
  });

  const rawText = session.finalize() + '\n';
  const text = normalizeSnapshotOutput(rawText).replace(
    /\n(✅ \d+ simulators available)/,
    '\n\n$1',
  );

  return {
    text,
    isError: session.isError(),
  };
}

describe('simulator-management workflow', () => {
  let harness: SnapshotHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('list', () => {
    it('success', async () => {
      const { text, isError } = await invokeDeterministicSimulatorList();
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'list--success');
    });
  });

  describe('boot', () => {
    it('error - invalid id', async () => {
      const { text } = await harness.invoke('simulator-management', 'boot', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
      });
      expectMatchesFixture(text, __filename, 'boot--error-invalid-id');
    });
  });

  describe('open', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'open', {});
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'open--success');
    });
  });

  describe('set-appearance', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'set-appearance', {
        simulatorId: simulatorUdid,
        mode: 'dark',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'set-appearance--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'set-appearance', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
        mode: 'dark',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'set-appearance--error-invalid-simulator');
    });
  });

  describe('set-location', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'set-location', {
        simulatorId: simulatorUdid,
        latitude: 37.7749,
        longitude: -122.4194,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'set-location--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'set-location', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
        latitude: 37.7749,
        longitude: -122.4194,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'set-location--error-invalid-simulator');
    });
  });

  describe('reset-location', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'reset-location', {
        simulatorId: simulatorUdid,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'reset-location--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'reset-location', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'reset-location--error-invalid-simulator');
    });
  });

  describe('statusbar', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'statusbar', {
        simulatorId: simulatorUdid,
        dataNetwork: 'wifi',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'statusbar--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'statusbar', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
        dataNetwork: 'wifi',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'statusbar--error-invalid-simulator');
    });
  });

  describe('erase', () => {
    it('error - invalid id', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'erase', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'erase--error-invalid-id');
    });

    it('success', async () => {
      const throwawayUdid = execSync('xcrun simctl create "SnapshotTestThrowaway" "iPhone 16"', {
        encoding: 'utf8',
      }).trim();

      try {
        const { text, isError } = await harness.invoke('simulator-management', 'erase', {
          simulatorId: throwawayUdid,
        });
        expect(isError).toBe(false);
        expectMatchesFixture(text, __filename, 'erase--success');
      } finally {
        try {
          execSync(`xcrun simctl delete ${throwawayUdid}`);
        } catch {
          // Simulator may already be deleted
        }
      }
    }, 60_000);
  });
});
