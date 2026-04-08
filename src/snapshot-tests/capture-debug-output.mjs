/**
 * Script to capture actual output from debugging tools for fixture comparison.
 * Run with: node --experimental-vm-modules src/snapshot-tests/capture-debug-output.mjs
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';

// Find simulator
const listOutput = execSync('xcrun simctl list devices available --json', { encoding: 'utf8' });
const data = JSON.parse(listOutput);
let simulatorUdid = null;
for (const runtime of Object.values(data.devices)) {
  for (const device of runtime) {
    if (device.name === 'iPhone 17') {
      if (device.state !== 'Booted') {
        execSync(`xcrun simctl boot ${device.udid}`, { encoding: 'utf8' });
      }
      simulatorUdid = device.udid;
      break;
    }
  }
  if (simulatorUdid) break;
}

console.log('Simulator UDID:', simulatorUdid);
console.log('Launching app...');

execSync(`xcrun simctl launch --terminate-running-process ${simulatorUdid} ${BUNDLE_ID}`, {
  encoding: 'utf8',
  stdio: 'pipe',
});

await new Promise((r) => setTimeout(r, 2000));

// Now dynamically import the tool modules
const { importToolModule } = await import(`${projectRoot}/build/core/manifest/import-tool-module.js`);
const { normalizeSnapshotOutput } = await import(`${projectRoot}/build/snapshot-tests/normalize.js`).catch(() => {
  // If not in build, use the project normalize
  return import(`${projectRoot}/src/snapshot-tests/normalize.ts`);
});

console.log('Modules loaded');
