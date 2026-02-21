import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../core/resource-root.ts', () => ({
  getResourceRoot: vi.fn(),
}));

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: vi.fn(original.homedir),
  };
});

import { getResourceRoot } from '../../../core/resource-root.ts';
import { homedir } from 'node:os';

const mockedGetResourceRoot = vi.mocked(getResourceRoot);
const mockedHomedir = vi.mocked(homedir);

function loadInitModule() {
  return import('../init.ts');
}

describe('init command', () => {
  let tempDir: string;
  let fakeResourceRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xbmcp-init-'));
    fakeResourceRoot = join(tempDir, 'resource-root');
    mkdirSync(join(fakeResourceRoot, 'skills', 'xcodebuildmcp'), { recursive: true });
    mkdirSync(join(fakeResourceRoot, 'skills', 'xcodebuildmcp-cli'), { recursive: true });
    writeFileSync(
      join(fakeResourceRoot, 'skills', 'xcodebuildmcp', 'SKILL.md'),
      '# MCP Skill Content',
      'utf8',
    );
    writeFileSync(
      join(fakeResourceRoot, 'skills', 'xcodebuildmcp-cli', 'SKILL.md'),
      '# CLI Skill Content',
      'utf8',
    );
    mockedGetResourceRoot.mockReturnValue(fakeResourceRoot);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('registerInitCommand', () => {
    it('exports registerInitCommand function', async () => {
      const mod = await loadInitModule();
      expect(typeof mod.registerInitCommand).toBe('function');
    });
  });

  describe('skill installation', () => {
    it('installs CLI skill to a destination directory', async () => {
      const dest = join(tempDir, 'skills');
      mkdirSync(dest, { recursive: true });

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'cli']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      const installed = join(dest, 'xcodebuildmcp-cli', 'SKILL.md');
      expect(existsSync(installed)).toBe(true);
      expect(readFileSync(installed, 'utf8')).toBe('# CLI Skill Content');

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Installed XcodeBuildMCP CLI skill');
      expect(output).toContain('Custom');
      expect(output).toContain(installed);

      stdoutSpy.mockRestore();
    });

    it('installs MCP skill to a destination directory', async () => {
      const dest = join(tempDir, 'skills');
      mkdirSync(dest, { recursive: true });

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'mcp']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      const installed = join(dest, 'xcodebuildmcp', 'SKILL.md');
      expect(existsSync(installed)).toBe(true);
      expect(readFileSync(installed, 'utf8')).toBe('# MCP Skill Content');

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Installed XcodeBuildMCP (MCP server) skill');

      stdoutSpy.mockRestore();
    });

    it('defaults to CLI skill when --skill is omitted', async () => {
      const dest = join(tempDir, 'skills');
      mkdirSync(dest, { recursive: true });

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest]).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      expect(existsSync(join(dest, 'xcodebuildmcp-cli', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(dest, 'xcodebuildmcp', 'SKILL.md'))).toBe(false);

      stdoutSpy.mockRestore();
    });
  });

  describe('conflict handling', () => {
    it('removes conflicting skill with --remove-conflict', async () => {
      const dest = join(tempDir, 'skills');
      const conflictDir = join(dest, 'xcodebuildmcp');
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, 'SKILL.md'), 'old mcp skill', 'utf8');

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'cli', '--remove-conflict']).scriptName(
        '',
      );
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      expect(existsSync(conflictDir)).toBe(false);
      expect(existsSync(join(dest, 'xcodebuildmcp-cli', 'SKILL.md'))).toBe(true);

      stdoutSpy.mockRestore();
    });

    it('errors on conflict in non-interactive mode without --remove-conflict', async () => {
      const dest = join(tempDir, 'skills');
      const conflictDir = join(dest, 'xcodebuildmcp');
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, 'SKILL.md'), 'old mcp skill', 'utf8');

      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'cli']).scriptName('').fail(false);
      mod.registerInitCommand(app);

      await expect(app.parseAsync()).rejects.toThrow('Conflicting skill');

      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });

  describe('--force', () => {
    it('overwrites existing installation with --force', async () => {
      const dest = join(tempDir, 'skills');
      const existingDir = join(dest, 'xcodebuildmcp-cli');
      mkdirSync(existingDir, { recursive: true });
      writeFileSync(join(existingDir, 'SKILL.md'), 'old content', 'utf8');

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'cli', '--force']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf8')).toBe('# CLI Skill Content');

      stdoutSpy.mockRestore();
    });
  });

  describe('--uninstall', () => {
    it('removes all installed skill directories', async () => {
      const dest = join(tempDir, 'skills');
      const cliSkillDir = join(dest, 'xcodebuildmcp-cli');
      const mcpSkillDir = join(dest, 'xcodebuildmcp');
      mkdirSync(cliSkillDir, { recursive: true });
      mkdirSync(mcpSkillDir, { recursive: true });
      writeFileSync(join(cliSkillDir, 'SKILL.md'), 'cli content', 'utf8');
      writeFileSync(join(mcpSkillDir, 'SKILL.md'), 'mcp content', 'utf8');

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--uninstall']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      expect(existsSync(cliSkillDir)).toBe(false);
      expect(existsSync(mcpSkillDir)).toBe(false);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Uninstalled skill directories');
      expect(output).toContain('Removed (xcodebuildmcp-cli):');
      expect(output).toContain('Removed (xcodebuildmcp):');

      stdoutSpy.mockRestore();
    });

    it('reports when no skill is installed', async () => {
      const dest = join(tempDir, 'skills');
      mkdirSync(dest, { recursive: true });

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--uninstall']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('No installed skill directories found');

      stdoutSpy.mockRestore();
    });

    it('gracefully reports no installed skills when auto-detect finds no clients', async () => {
      const emptyHome = join(tempDir, 'empty-home-uninstall');
      mkdirSync(emptyHome, { recursive: true });
      mockedHomedir.mockReturnValue(emptyHome);

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--uninstall']).scriptName('').fail(false);
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('No installed skill directories found');

      stdoutSpy.mockRestore();
    });
  });

  describe('--print', () => {
    it('prints CLI skill content to stdout', async () => {
      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--print', '--skill', 'cli']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toBe('# CLI Skill Content');

      stdoutSpy.mockRestore();
    });

    it('prints MCP skill content to stdout', async () => {
      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--print', '--skill', 'mcp']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toBe('# MCP Skill Content');

      stdoutSpy.mockRestore();
    });

    it('does not create any skill directories when using --print', async () => {
      const emptyHome = join(tempDir, 'print-home');
      mkdirSync(emptyHome, { recursive: true });
      mockedHomedir.mockReturnValue(emptyHome);

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--print']).scriptName('');
      mod.registerInitCommand(app);

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await app.parseAsync();

      expect(existsSync(join(emptyHome, '.claude', 'skills'))).toBe(false);
      expect(existsSync(join(emptyHome, '.cursor', 'skills'))).toBe(false);
      expect(existsSync(join(emptyHome, '.codex', 'skills', 'public'))).toBe(false);

      stdoutSpy.mockRestore();
    });
  });

  describe('error cases', () => {
    it('errors when --dest points to filesystem root', async () => {
      const rootDest = '/';

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', rootDest, '--skill', 'cli']).scriptName('').fail(false);
      mod.registerInitCommand(app);

      await expect(app.parseAsync()).rejects.toThrow(
        'Refusing to use filesystem root as skills destination',
      );
    });

    it('errors when skill source file is missing', async () => {
      rmSync(join(fakeResourceRoot, 'skills', 'xcodebuildmcp-cli', 'SKILL.md'));

      const dest = join(tempDir, 'skills');
      mkdirSync(dest, { recursive: true });

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'cli']).scriptName('').fail(false);
      mod.registerInitCommand(app);

      await expect(app.parseAsync()).rejects.toThrow('Skill source not found');
    });

    it('does not delete conflicting skill when source file is missing', async () => {
      rmSync(join(fakeResourceRoot, 'skills', 'xcodebuildmcp-cli', 'SKILL.md'));

      const dest = join(tempDir, 'skills');
      const conflictDir = join(dest, 'xcodebuildmcp');
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, 'SKILL.md'), 'existing mcp skill', 'utf8');

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--dest', dest, '--skill', 'cli', '--remove-conflict'])
        .scriptName('')
        .fail(false);
      mod.registerInitCommand(app);

      await expect(app.parseAsync()).rejects.toThrow('Skill source not found');
      expect(existsSync(conflictDir)).toBe(true);
      expect(readFileSync(join(conflictDir, 'SKILL.md'), 'utf8')).toBe('existing mcp skill');
    });

    it('errors when no clients detected and no --dest or --print', async () => {
      const emptyHome = join(tempDir, 'empty-home');
      mkdirSync(emptyHome, { recursive: true });
      mockedHomedir.mockReturnValue(emptyHome);

      const yargs = (await import('yargs')).default;
      const mod = await loadInitModule();

      const app = yargs(['init', '--skill', 'cli']).scriptName('').fail(false);
      mod.registerInitCommand(app);

      await expect(app.parseAsync()).rejects.toThrow('No supported AI clients detected');
    });
  });
});
