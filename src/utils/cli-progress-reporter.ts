import * as clack from '@clack/prompts';

export interface CliProgressReporter {
  update(message: string): void;
  clear(): void;
}

export function createCliProgressReporter(): CliProgressReporter {
  const spinner = clack.spinner();
  let active = false;

  return {
    update(message: string): void {
      if (!active) {
        spinner.start(message);
        active = true;
        return;
      }

      spinner.message(message);
    },
    clear(): void {
      if (!active) {
        return;
      }

      spinner.clear();
      active = false;
    },
  };
}
