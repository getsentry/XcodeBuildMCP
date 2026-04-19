/**
 * Script to capture actual output from debugging tools for fixture comparison.
 * Run with: node --experimental-vm-modules src/snapshot-tests/capture-debug-output.mjs
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(projectRoot, 'build/cli.js');
const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

function runCli(workflow, cliToolName, args, output = 'text') {
  return execFileSync(
    'node',
    [CLI_PATH, workflow, cliToolName, '--json', JSON.stringify(args), '--output', output],
    {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: 'pipe',
    },
  );
}

function parseSimulatorList(output) {
  const simulators = [];
  const lines = output.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const simulatorLine = lines[index]?.match(/^\s*📱\s+\[[✓✗]\]\s+(.+)\s+\((Booted|Shutdown)\)\s*$/u);
    if (!simulatorLine) continue;

    const udidLine = lines[index + 1]?.match(/^\s*UDID:\s+([0-9A-Fa-f-]+)\s*$/);
    if (!udidLine?.[1]) continue;

    simulators.push({
      name: simulatorLine[1],
      state: simulatorLine[2],
      udid: udidLine[1],
    });
    index += 1;
  }

  return simulators;
}

const simulators = parseSimulatorList(runCli('simulator-management', 'list', {}, 'text'));
const simulator = simulators.find((entry) => entry.name === 'iPhone 17');

if (!simulator) {
  throw new Error('iPhone 17 simulator not found');
}

if (simulator.state !== 'Booted') {
  runCli('simulator-management', 'boot', { simulatorId: simulator.udid });
}

console.log('Simulator UDID:', simulator.udid);
console.log('Launching app...');

runCli('simulator', 'build-and-run', {
  workspacePath: WORKSPACE,
  scheme: 'CalculatorApp',
  simulatorId: simulator.udid,
});

await new Promise((r) => setTimeout(r, 2000));

const { importToolModule } = await import(`${projectRoot}/build/core/manifest/import-tool-module.js`);
const { normalizeSnapshotOutput } = await import(`${projectRoot}/build/snapshot-tests/normalize.js`).catch(() => {
  return import(`${projectRoot}/src/snapshot-tests/normalize.ts`);
});

void importToolModule;
void normalizeSnapshotOutput;
console.log('Modules loaded');
