import { spawn } from 'node:child_process';
import process from 'node:process';

const [nodeExecPath, cliPath, cwd, exitDelayMsRaw] = process.argv.slice(2);
const exitDelayMs = Number(exitDelayMsRaw ?? 0);

if (!nodeExecPath || !cliPath || !cwd || !Number.isFinite(exitDelayMs) || exitDelayMs < 0) {
  console.error('Usage: node repro-mcp-parent-exit-helper.mjs <nodeExecPath> <cliPath> <cwd> <exitDelayMs>');
  process.exit(2);
}

const child = spawn(nodeExecPath, [cliPath, 'mcp'], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
});

process.stdout.write(`${child.pid}\n`);

setTimeout(() => {
  process.exit(0);
}, exitDelayMs);
