export type OutputFormat = 'text' | 'json' | 'jsonl' | 'raw';

export function formatToolList(
  tools: Array<{ cliName: string; workflow: string; description?: string; stateful: boolean }>,
  options: { grouped?: boolean; verbose?: boolean } = {},
): string {
  const lines: string[] = [];

  if (options.grouped) {
    const byWorkflow = new Map<string, typeof tools>();
    for (const tool of tools) {
      let group = byWorkflow.get(tool.workflow);
      if (!group) {
        group = [];
        byWorkflow.set(tool.workflow, group);
      }
      group.push(tool);
    }

    const sortedWorkflows = [...byWorkflow.keys()].sort();
    for (const workflow of sortedWorkflows) {
      lines.push(`\n${workflow}:`);
      const workflowTools = byWorkflow.get(workflow) ?? [];
      const sortedTools = workflowTools.sort((a, b) => a.cliName.localeCompare(b.cliName));

      for (const tool of sortedTools) {
        const statefulMarker = tool.stateful ? ' [stateful]' : '';
        if (options.verbose && tool.description) {
          lines.push(`  ${tool.cliName}${statefulMarker}`);
          lines.push(`    ${tool.description}`);
        } else {
          const desc = tool.description ? ` - ${truncate(tool.description, 60)}` : '';
          lines.push(`  ${tool.cliName}${statefulMarker}${desc}`);
        }
      }
    }
  } else {
    const sortedTools = [...tools].sort((a, b) => {
      const aFull = `${a.workflow} ${a.cliName}`;
      const bFull = `${b.workflow} ${b.cliName}`;
      return aFull.localeCompare(bFull);
    });

    for (const tool of sortedTools) {
      const fullCommand = `${tool.workflow} ${tool.cliName}`;
      const statefulMarker = tool.stateful ? ' [stateful]' : '';
      if (options.verbose && tool.description) {
        lines.push(`${fullCommand}${statefulMarker}`);
        lines.push(`  ${tool.description}`);
      } else {
        const desc = tool.description ? ` - ${truncate(tool.description, 60)}` : '';
        lines.push(`${fullCommand}${statefulMarker}${desc}`);
      }
    }
  }

  return lines.join('\n');
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
