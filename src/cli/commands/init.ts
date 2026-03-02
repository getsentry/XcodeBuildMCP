import type { Argv } from 'yargs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { getResourceRoot } from '../../core/resource-root.ts';

type SkillType = 'mcp' | 'cli';

interface ClientInfo {
  name: string;
  id: string;
  skillsDir: string;
}

const CLIENT_DEFINITIONS: { id: string; name: string; skillsSubdir: string }[] = [
  { id: 'claude', name: 'Claude Code', skillsSubdir: '.claude/skills' },
  { id: 'cursor', name: 'Cursor', skillsSubdir: '.cursor/skills' },
  { id: 'codex', name: 'Codex', skillsSubdir: '.codex/skills/public' },
];

const AGENTS_FILE_NAME = 'AGENTS.md';
const AGENTS_LEGACY_GUIDANCE_LINE =
  '- If using XcodeBuildMCP, first find and read the installed XcodeBuildMCP skill before calling XcodeBuildMCP tools.';
const AGENTS_GUIDANCE_LINE =
  '- If using XcodeBuildMCP, use the installed XcodeBuildMCP skill before calling XcodeBuildMCP tools.';

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function skillDirName(skillType: SkillType): string {
  return skillType === 'mcp' ? 'xcodebuildmcp' : 'xcodebuildmcp-cli';
}

function altSkillDirName(skillType: SkillType): string {
  return skillType === 'mcp' ? 'xcodebuildmcp-cli' : 'xcodebuildmcp';
}

function skillDisplayName(skillType: SkillType): string {
  return skillType === 'mcp' ? 'XcodeBuildMCP (MCP server)' : 'XcodeBuildMCP CLI';
}

function detectClients(): ClientInfo[] {
  const home = os.homedir();
  const detected: ClientInfo[] = [];

  for (const def of CLIENT_DEFINITIONS) {
    const clientDir = path.join(home, def.skillsSubdir.split('/')[0]);
    if (fs.existsSync(clientDir)) {
      detected.push({
        name: def.name,
        id: def.id,
        skillsDir: path.join(home, def.skillsSubdir),
      });
    }
  }

  return detected;
}

function getSkillSourcePath(skillType: SkillType): string {
  const resourceRoot = getResourceRoot();
  return path.join(resourceRoot, 'skills', skillDirName(skillType), 'SKILL.md');
}

function readSkillContent(skillType: SkillType): string {
  const sourcePath = getSkillSourcePath(skillType);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Skill source not found: ${sourcePath}`);
  }
  return fs.readFileSync(sourcePath, 'utf8');
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(`${question} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

interface InstallResult {
  client: string;
  location: string;
}

interface InstallPolicyResult {
  allowedTargets: ClientInfo[];
  skippedClients: Array<{ client: string; reason: string }>;
}

function formatSkippedClients(skippedClients: Array<{ client: string; reason: string }>): string {
  if (skippedClients.length === 0) {
    return '';
  }

  return skippedClients.map((skipped) => `${skipped.client}: ${skipped.reason}`).join('; ');
}

async function installSkill(
  skillsDir: string,
  clientName: string,
  skillType: SkillType,
  opts: { force: boolean; removeConflict: boolean },
): Promise<InstallResult> {
  const targetDir = path.join(skillsDir, skillDirName(skillType));
  const altDir = path.join(skillsDir, altSkillDirName(skillType));
  const targetFile = path.join(targetDir, 'SKILL.md');
  const content = readSkillContent(skillType);

  if (fs.existsSync(altDir)) {
    if (opts.removeConflict) {
      fs.rmSync(altDir, { recursive: true, force: true });
    } else {
      const altType = skillType === 'mcp' ? 'cli' : 'mcp';
      if (!process.stdin.isTTY) {
        throw new Error(
          `Conflicting skill "${altSkillDirName(skillType)}" found in ${skillsDir}. ` +
            `Use --remove-conflict to auto-remove it, or uninstall the ${altType} skill first.`,
        );
      }

      const confirmed = await promptYesNo(
        `Conflicting skill "${altSkillDirName(skillType)}" found in ${skillsDir}.\n  Remove it?`,
      );
      if (!confirmed) {
        throw new Error('Installation cancelled due to conflicting skill.');
      }
      fs.rmSync(altDir, { recursive: true, force: true });
    }
  }

  if (fs.existsSync(targetFile) && !opts.force) {
    if (!process.stdin.isTTY) {
      throw new Error(`Skill already installed at ${targetFile}. Use --force to overwrite.`);
    }

    const confirmed = await promptYesNo(`Skill already installed at ${targetFile}.\n  Overwrite?`);
    if (!confirmed) {
      throw new Error('Installation cancelled.');
    }
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetFile, content, 'utf8');

  return { client: clientName, location: targetFile };
}

function uninstallSkill(
  skillsDir: string,
  clientName: string,
): { client: string; removed: Array<{ variant: string; path: string }> } | null {
  const removed: Array<{ variant: string; path: string }> = [];
  for (const variant of ['xcodebuildmcp', 'xcodebuildmcp-cli']) {
    const dir = path.join(skillsDir, variant);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push({ variant, path: dir });
    }
  }

  if (removed.length === 0) {
    return null;
  }

  return { client: clientName, removed };
}

function resolveTargets(
  clientFlag: string | undefined,
  destFlag: string | undefined,
  operation: 'install' | 'uninstall',
): ClientInfo[] {
  if (destFlag) {
    const resolvedDest = path.resolve(destFlag);
    if (resolvedDest === path.parse(resolvedDest).root) {
      throw new Error(
        'Refusing to use filesystem root as skills destination. Use a dedicated directory.',
      );
    }
    return [{ name: 'Custom', id: 'custom', skillsDir: resolvedDest }];
  }

  if (clientFlag && clientFlag !== 'auto') {
    const def = CLIENT_DEFINITIONS.find((d) => d.id === clientFlag);
    if (!def) {
      throw new Error(`Unknown client: ${clientFlag}. Valid clients: claude, cursor, codex`);
    }
    const home = os.homedir();
    return [{ name: def.name, id: def.id, skillsDir: path.join(home, def.skillsSubdir) }];
  }

  const detected = detectClients();
  if (detected.length === 0) {
    if (operation === 'uninstall') {
      return [];
    }

    throw new Error(
      'No supported AI clients detected.\n' +
        'Use --client to specify a client, --dest to specify a custom path, or --print to output the skill content.',
    );
  }
  return detected;
}

function renderAgentsAppendDiff(fileName: string): string {
  return `--- ${fileName}\n+++ ${fileName}\n@@\n+${AGENTS_GUIDANCE_LINE}`;
}

async function ensureAgentsGuidance(
  projectRoot: string,
  force: boolean,
): Promise<'created' | 'updated' | 'no_change' | 'skipped'> {
  const agentsPath = path.join(projectRoot, AGENTS_FILE_NAME);
  if (!fs.existsSync(agentsPath)) {
    const newContent = `# ${AGENTS_FILE_NAME}\n\n${AGENTS_GUIDANCE_LINE}\n`;
    fs.writeFileSync(agentsPath, newContent, 'utf8');
    writeLine(`Created ${AGENTS_FILE_NAME} with XcodeBuildMCP guidance at ${agentsPath}`);
    return 'created';
  }

  const currentContent = fs.readFileSync(agentsPath, 'utf8');
  if (currentContent.includes(AGENTS_GUIDANCE_LINE)) {
    writeLine(`${AGENTS_FILE_NAME} already includes XcodeBuildMCP guidance.`);
    return 'no_change';
  }

  if (currentContent.includes(AGENTS_LEGACY_GUIDANCE_LINE)) {
    const updatedFromLegacy = currentContent.replace(
      AGENTS_LEGACY_GUIDANCE_LINE,
      AGENTS_GUIDANCE_LINE,
    );
    fs.writeFileSync(agentsPath, updatedFromLegacy, 'utf8');
    writeLine(`Updated ${AGENTS_FILE_NAME} at ${agentsPath}`);
    return 'updated';
  }

  const diff = renderAgentsAppendDiff(AGENTS_FILE_NAME);
  writeLine(`Proposed update for ${agentsPath}:`);
  writeLine(diff);

  if (!force) {
    if (!process.stdin.isTTY) {
      throw new Error(
        `${AGENTS_FILE_NAME} exists and requires confirmation to update. Re-run with --force to apply the change in non-interactive mode.`,
      );
    }

    const confirmed = await promptYesNo(`Update ${AGENTS_FILE_NAME} with the guidance above?`);
    if (!confirmed) {
      writeLine(`Skipped updating ${AGENTS_FILE_NAME}.`);
      return 'skipped';
    }
  }

  const updatedContent = currentContent.endsWith('\n')
    ? `${currentContent}${AGENTS_GUIDANCE_LINE}\n`
    : `${currentContent}\n${AGENTS_GUIDANCE_LINE}\n`;

  fs.writeFileSync(agentsPath, updatedContent, 'utf8');
  writeLine(`Updated ${AGENTS_FILE_NAME} at ${agentsPath}`);
  return 'updated';
}

export function registerInitCommand(app: Argv, ctx?: { workspaceRoot: string }): void {
  app.command(
    'init',
    'Install XcodeBuildMCP agent skill',
    (yargs) => {
      return yargs
        .option('client', {
          type: 'string',
          describe: 'Target client: claude, cursor, codex (default: auto-detect)',
          choices: ['auto', 'claude', 'cursor', 'codex'] as const,
          default: 'auto',
        })
        .option('skill', {
          type: 'string',
          describe: 'Skill variant: mcp or cli',
          choices: ['mcp', 'cli'] as const,
          default: 'cli',
        })
        .option('dest', {
          type: 'string',
          describe: 'Custom destination directory (overrides --client)',
        })
        .option('force', {
          type: 'boolean',
          default: false,
          describe: 'Replace existing skill without prompting',
        })
        .option('remove-conflict', {
          type: 'boolean',
          default: false,
          describe: 'Auto-remove conflicting skill variant',
        })
        .option('uninstall', {
          type: 'boolean',
          default: false,
          describe: 'Remove the installed skill',
        })
        .option('print', {
          type: 'boolean',
          default: false,
          describe: 'Print the skill content to stdout instead of installing',
        });
    },
    async (argv) => {
      const skillType = argv.skill as SkillType;
      const clientFlag = argv.client as string | undefined;
      const destFlag = argv.dest as string | undefined;

      if (argv.print) {
        const content = readSkillContent(skillType);
        process.stdout.write(content);
        return;
      }

      if (argv.uninstall) {
        const targets = resolveTargets(clientFlag, destFlag, 'uninstall');
        let anyRemoved = false;

        for (const target of targets) {
          const result = uninstallSkill(target.skillsDir, target.name);
          if (result) {
            if (!anyRemoved) {
              writeLine('Uninstalled skill directories');
            }
            writeLine(`  Client: ${result.client}`);
            for (const removed of result.removed) {
              writeLine(`  Removed (${removed.variant}): ${removed.path}`);
            }
            anyRemoved = true;
          }
        }

        if (!anyRemoved) {
          writeLine('No installed skill directories found to remove.');
        }
        return;
      }

      const targets = resolveTargets(clientFlag, destFlag, 'install');

      const policy = enforceInstallPolicy(targets, skillType, clientFlag, destFlag);
      for (const skipped of policy.skippedClients) {
        writeLine(`Skipped ${skipped.client}: ${skipped.reason}`);
      }

      if (policy.allowedTargets.length === 0) {
        const skippedSummary = formatSkippedClients(policy.skippedClients);
        const reasonSuffix = skippedSummary.length > 0 ? ` Skipped: ${skippedSummary}` : '';
        throw new Error(`No eligible install targets after applying skill policy.${reasonSuffix}`);
      }

      const results: InstallResult[] = [];
      for (const target of policy.allowedTargets) {
        const result = await installSkill(target.skillsDir, target.name, skillType, {
          force: argv.force as boolean,
          removeConflict: argv['remove-conflict'] as boolean,
        });
        results.push(result);
      }

      writeLine(`Installed ${skillDisplayName(skillType)} skill`);
      for (const result of results) {
        writeLine(`  Client: ${result.client}`);
        writeLine(`  Location: ${result.location}`);
      }

      if (ctx?.workspaceRoot) {
        const projectRoot = path.resolve(ctx.workspaceRoot);
        await ensureAgentsGuidance(projectRoot, argv.force as boolean);
      }
    },
  );
}

function enforceInstallPolicy(
  targets: ClientInfo[],
  skillType: SkillType,
  clientFlag: string | undefined,
  destFlag: string | undefined,
): InstallPolicyResult {
  if (skillType !== 'mcp') {
    return { allowedTargets: targets, skippedClients: [] };
  }

  if (destFlag) {
    return { allowedTargets: targets, skippedClients: [] };
  }

  if (clientFlag === 'claude') {
    return { allowedTargets: targets, skippedClients: [] };
  }

  const allowedTargets: ClientInfo[] = [];
  const skippedClients: Array<{ client: string; reason: string }> = [];

  for (const target of targets) {
    if (target.id === 'claude') {
      skippedClients.push({
        client: target.name,
        reason: 'MCP skill is unnecessary because Claude Code already uses server instructions.',
      });
      continue;
    }
    allowedTargets.push(target);
  }

  return { allowedTargets, skippedClients };
}
