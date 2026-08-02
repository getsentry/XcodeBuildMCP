import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { shouldUpdateSnapshots } from './fixture-io.ts';

export type McpToolContractMode = 'session-defaults-disabled' | 'session-defaults-enabled';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'src/snapshot-tests/__fixtures__/mcp-contracts');
const SAFE_TOOL_NAME = /^[a-z0-9_-]+$/;
const INLINE_LIMIT = 240;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function formatValue(value: unknown, depth: number): string {
  if (isPrimitive(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inline = JSON.stringify(value);
    if (value.every(isPrimitive) && inline.length <= INLINE_LIMIT) return inline;

    const children = value.map((child) => indent(formatValue(child, depth + 1), 2));
    return `[\n${children.join(',\n')}\n]`;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  const inline = JSON.stringify(value);
  if (entries.every(([, child]) => isPrimitive(child)) && inline.length <= INLINE_LIMIT) {
    return inline;
  }

  const children = entries.map(([key, child]) => {
    const formatted = formatValue(child, depth + 1);
    const [first, ...rest] = formatted.split('\n');
    const lines = [`  ${JSON.stringify(key)}: ${first}`];
    lines.push(...rest.map((line) => `  ${line}`));
    return lines.join('\n');
  });
  return `{\n${children.join(',\n')}\n}`;
}

function formatTool(tool: Tool): string {
  return `${formatValue(canonicalize(tool), 0)}\n`;
}

function sortedToolNames(tools: readonly Tool[]): string[] {
  const names = tools.map((tool) => tool.name).sort();
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) {
    throw new Error('Live MCP tool contracts contain duplicate tool names.');
  }

  for (const name of names) {
    if (!SAFE_TOOL_NAME.test(name)) {
      throw new Error(`Unsafe MCP tool name for contract fixture: ${name}`);
    }
  }
  return names;
}

function existingFixtureNames(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort();
}

function assertInventory(mode: McpToolContractMode, expected: string[], actual: string[]): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const stale = actual.filter((name) => !expectedSet.has(name));
  throw new Error(
    [
      `MCP tool contract fixture inventory mismatch for ${mode}.`,
      `Missing: ${missing.length > 0 ? missing.join(', ') : '(none)'}`,
      `Stale: ${stale.length > 0 ? stale.join(', ') : '(none)'}`,
      'Run npm run test:schema-fixtures:update to intentionally refresh contracts.',
    ].join('\n'),
  );
}

export function expectMcpToolContractFixtures(
  mode: McpToolContractMode,
  tools: readonly Tool[],
): void {
  const directory = path.join(FIXTURE_ROOT, mode);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const liveNames = sortedToolNames(tools);
  const fixtureNames = existingFixtureNames(directory);

  if (shouldUpdateSnapshots()) {
    fs.mkdirSync(directory, { recursive: true });
    for (const staleName of fixtureNames.filter((name) => !toolsByName.has(name))) {
      fs.unlinkSync(path.join(directory, `${staleName}.json`));
    }
    for (const name of liveNames) {
      fs.writeFileSync(
        path.join(directory, `${name}.json`),
        formatTool(toolsByName.get(name)!),
        'utf8',
      );
    }
    return;
  }

  assertInventory(mode, liveNames, fixtureNames);
  for (const name of liveNames) {
    const fixturePath = path.join(directory, `${name}.json`);
    const expected = fs.readFileSync(fixturePath, 'utf8');
    const actual = formatTool(toolsByName.get(name)!);
    if (actual !== expected) {
      throw new Error(
        `MCP tool contract fixture mismatch: ${path.relative(process.cwd(), fixturePath)}\n` +
          'Run npm run test:schema-fixtures:update to intentionally refresh contracts.',
      );
    }
  }
}
