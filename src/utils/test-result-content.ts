import type { ToolResponseContent } from '../types/common.ts';

export interface XcresultSummary {
  formatted: string;
  totalTestCount: number;
}

export function filterStderrContent(
  content: ToolResponseContent[] | undefined,
): ToolResponseContent[] {
  if (!content) {
    return [];
  }

  const filtered: ToolResponseContent[] = [];
  content.forEach((item) => {
    if (item.type !== 'text') {
      filtered.push(item);
      return;
    }

    const lines = item.text.split('\n').filter((line) => !line.includes('[stderr]'));

    // Clean up orphaned separators left by consolidateContentForClaudeCode.
    // That function joins content blocks with `\n---\n`, so removing [stderr]
    // lines can leave bare `---` lines stacked together or dangling at edges.
    const cleaned: string[] = [];
    for (const line of lines) {
      if (
        line.trim() === '---' &&
        (cleaned.length === 0 || cleaned[cleaned.length - 1].trim() === '---')
      ) {
        continue;
      }
      cleaned.push(line);
    }

    // Remove trailing separator
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '---') {
      cleaned.pop();
    }

    const filteredText = cleaned.join('\n').trim();

    if (filteredText.length === 0) {
      return;
    }

    filtered.push({ ...item, text: filteredText });
  });

  return filtered;
}
