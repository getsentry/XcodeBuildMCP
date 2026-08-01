import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { McpToolContractFixture } from '../capture-mcp-tool-contracts.ts';

const execFileAsync = promisify(execFile);
const fixtureDirectory = fileURLToPath(new URL('../fixtures/', import.meta.url));

async function readFixture(mode: 'adaptive' | 'full'): Promise<McpToolContractFixture> {
  const contents = await readFile(`${fixtureDirectory}mcp-tool-contracts.${mode}.json`, 'utf8');
  return JSON.parse(contents) as McpToolContractFixture;
}

async function captureFixture(mode: 'adaptive' | 'full'): Promise<McpToolContractFixture> {
  const { stdout } = await execFileAsync(process.execPath, [
    'build/contract-tests/capture-mcp-tool-contracts.js',
    mode,
  ]);
  return JSON.parse(stdout) as McpToolContractFixture;
}

describe('MCP static tool contracts', () => {
  it.each(['adaptive', 'full'] as const)(
    'matches the fail-closed %s schema baseline',
    async (mode) => {
      await expect(captureFixture(mode)).resolves.toEqual(await readFixture(mode));
    },
    30_000,
  );
});
