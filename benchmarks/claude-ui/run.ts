#!/usr/bin/env tsx
import { main } from '../../src/benchmarks/claude-ui/harness.ts';

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
