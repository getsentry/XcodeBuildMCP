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

  return content.flatMap((item): ToolResponseContent[] => {
    if (item.type !== 'text') {
      return [item];
    }

    const filteredText = item.text
      .split('\n')
      .filter((line) => !line.includes('[stderr]'))
      .join('\n')
      .trim();

    if (filteredText.length === 0) {
      return [];
    }

    return [{ ...item, text: filteredText }];
  });
}
