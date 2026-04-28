import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTemporarySimulator,
  deleteSimulator,
  ensureSimulatorBooted,
  shutdownSimulator,
} from '../harness.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const PRIMARY_SIMULATOR_NAME = 'iPhone 17 Pro';
const THROWAWAY_SIMULATOR_NAME = 'iPhone 17';
const IOS_26_4_RUNTIME_IDENTIFIER = 'com.apple.CoreSimulator.SimRuntime.iOS-26-4';

export function registerSimulatorManagementSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'simulator-management');

  describe(`${runtime} simulator-management workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let simulatorUdid: string;

    beforeAll(async () => {
      simulatorUdid = await ensureSimulatorBooted(PRIMARY_SIMULATOR_NAME);
      harness = await createHarnessForRuntime(runtime);
    });

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('list', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'list', {});
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'list--success');
      });
    });

    describe('boot', () => {
      it('success', async () => {
        const throwawaySimulatorUdid = await createTemporarySimulator(
          THROWAWAY_SIMULATOR_NAME,
          IOS_26_4_RUNTIME_IDENTIFIER,
        );

        try {
          const { text, isError } = await harness.invoke('simulator-management', 'boot', {
            simulatorId: throwawaySimulatorUdid,
          });
          expect(isError).toBe(false);
          expectFixture(text, 'boot--success');
        } finally {
          await shutdownSimulator(throwawaySimulatorUdid);
          await harness.invoke('simulator-management', 'erase', {
            simulatorId: throwawaySimulatorUdid,
          });
          await deleteSimulator(throwawaySimulatorUdid);
        }
      }, 60_000);

      it('error - invalid id', async () => {
        const { text } = await harness.invoke('simulator-management', 'boot', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
        });
        expectFixture(text, 'boot--error-invalid-id');
      });
    });

    describe('open', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'open', {});
        expect(isError).toBe(false);
        expectFixture(text, 'open--success');
      });
    });

    describe('set-appearance', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'set-appearance', {
          simulatorId: simulatorUdid,
          mode: 'dark',
        });
        expect(isError).toBe(false);
        expectFixture(text, 'set-appearance--success');
      });

      it('error - invalid simulator', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'set-appearance', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
          mode: 'dark',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'set-appearance--error-invalid-simulator');
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
        expectFixture(text, 'set-location--success');
      });

      it('error - invalid simulator', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'set-location', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
          latitude: 37.7749,
          longitude: -122.4194,
        });
        expect(isError).toBe(true);
        expectFixture(text, 'set-location--error-invalid-simulator');
      });
    });

    describe('reset-location', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'reset-location', {
          simulatorId: simulatorUdid,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'reset-location--success');
      });

      it('error - invalid simulator', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'reset-location', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'reset-location--error-invalid-simulator');
      });
    });

    describe('toggle-software-keyboard', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke(
          'simulator-management',
          'toggle-software-keyboard',
          {
            simulatorId: simulatorUdid,
          },
        );
        expect(isError).toBe(false);
        expectFixture(text, 'toggle-software-keyboard--success');
      });

      it('error - invalid simulator', async () => {
        const { text, isError } = await harness.invoke(
          'simulator-management',
          'toggle-software-keyboard',
          {
            simulatorId: '00000000-0000-0000-0000-000000000000',
          },
        );
        expect(isError).toBe(true);
        expectFixture(text, 'toggle-software-keyboard--error-invalid-simulator');
      });
    });

    describe('toggle-connect-hardware-keyboard', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke(
          'simulator-management',
          'toggle-connect-hardware-keyboard',
          {
            simulatorId: simulatorUdid,
          },
        );
        expect(isError).toBe(false);
        expectFixture(text, 'toggle-connect-hardware-keyboard--success');
      });

      it('error - invalid simulator', async () => {
        const { text, isError } = await harness.invoke(
          'simulator-management',
          'toggle-connect-hardware-keyboard',
          {
            simulatorId: '00000000-0000-0000-0000-000000000000',
          },
        );
        expect(isError).toBe(true);
        expectFixture(text, 'toggle-connect-hardware-keyboard--error-invalid-simulator');
      });
    });

    describe('statusbar', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'statusbar', {
          simulatorId: simulatorUdid,
          dataNetwork: 'wifi',
        });
        expect(isError).toBe(false);
        expectFixture(text, 'statusbar--success');
      });

      it('error - invalid simulator', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'statusbar', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
          dataNetwork: 'wifi',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'statusbar--error-invalid-simulator');
      });
    });

    describe('erase', () => {
      it('error - invalid id', async () => {
        const { text, isError } = await harness.invoke('simulator-management', 'erase', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'erase--error-invalid-id');
      });

      it('success', async () => {
        const throwawaySimulatorUdid = await createTemporarySimulator(
          THROWAWAY_SIMULATOR_NAME,
          IOS_26_4_RUNTIME_IDENTIFIER,
        );

        try {
          const bootResult = await harness.invoke('simulator-management', 'boot', {
            simulatorId: throwawaySimulatorUdid,
          });
          expect(bootResult.isError).toBe(false);

          await shutdownSimulator(throwawaySimulatorUdid);

          const { text, isError } = await harness.invoke('simulator-management', 'erase', {
            simulatorId: throwawaySimulatorUdid,
          });
          expect(isError).toBe(false);
          expectFixture(text, 'erase--success');
        } finally {
          await deleteSimulator(throwawaySimulatorUdid);
        }
      }, 60_000);
    });
  });
}
