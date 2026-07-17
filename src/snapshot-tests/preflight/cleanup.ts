export type CleanupAction = () => void | Promise<void>;

interface RegisteredCleanup {
  label: string;
  action: CleanupAction;
}

export class CleanupStack {
  private readonly actions: RegisteredCleanup[] = [];

  defer(label: string, action: CleanupAction): void {
    this.actions.push({ label, action });
  }

  async cleanup(): Promise<void> {
    const failures: Error[] = [];

    while (this.actions.length > 0) {
      const cleanup = this.actions.pop()!;
      try {
        await cleanup.action();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(new Error(`${cleanup.label}: ${message}`, { cause: error }));
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} cleanup action(s) failed`);
    }
  }
}
