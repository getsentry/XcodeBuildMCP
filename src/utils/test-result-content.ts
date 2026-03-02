import type { ToolResponseContent } from '../types/common.ts';

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

    const filteredText = item.text
      .split('\n')
      .filter((line) => !line.includes('[stderr]'))
      .join('\n')
      .trim();

    if (filteredText.length === 0) {
      return;
    }

    filtered.push({ ...item, text: filteredText });
  });

  return filtered;
}
