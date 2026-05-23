import type {
  PatternFailureRecord,
  ToolCallRecord,
  ToolFailureRecord,
  TranscriptAudit,
} from './types.ts';

const UI_AUTOMATION_TOOLS = new Set([
  'batch',
  'button',
  'drag',
  'gesture',
  'key_press',
  'key_sequence',
  'long_press',
  'screenshot',
  'snapshot_ui',
  'swipe',
  'tap',
  'touch',
  'type_text',
  'wait_for_ui',
]);

interface AnalyzeOptions {
  mcpToolPrefix: string;
  failurePatterns?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function shortToolName(fullName: string): string {
  const parts = fullName.split('__');
  return parts[parts.length - 1] ?? fullName;
}

function incrementCount(counts: Record<string, number>, name: string): void {
  counts[name] = (counts[name] ?? 0) + 1;
}

function parseEmbeddedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function extractContentBlocks(entry: Record<string, unknown>): unknown[] {
  const message = entry.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (Array.isArray(content)) return content;
  return [];
}

function extractStatus(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const data = value.data;
  if (!isRecord(data)) return undefined;
  const summary = data.summary;
  if (!isRecord(summary)) return undefined;
  return asString(summary.status);
}

function extractStructuredResult(
  block: Record<string, unknown>,
  entry: Record<string, unknown>,
): unknown {
  const direct = block.structuredContent;
  if (direct !== undefined) return direct;

  const content = parseEmbeddedJson(block.content);
  if (isRecord(content)) return content;

  const toolUseResult = entry.tool_use_result;
  if (isRecord(toolUseResult)) {
    if (toolUseResult.structuredContent !== undefined) return toolUseResult.structuredContent;
    const parsed = parseEmbeddedJson(toolUseResult.content);
    if (isRecord(parsed)) return parsed;
  }

  return content;
}

function resultDidError(block: Record<string, unknown>, structured: unknown): boolean {
  if (block.is_error === true) return true;
  if (isRecord(structured)) {
    if (structured.didError === true) return true;
    const status = extractStatus(structured);
    if (status === 'FAILED') return true;
  }
  return false;
}

function createPatternMatchers(
  patterns: string[] | undefined,
): Array<{ pattern: string; regex: RegExp }> {
  return (patterns ?? []).map((pattern) => ({ pattern, regex: new RegExp(pattern, 'i') }));
}

export function analyzeClaudeJsonl(text: string, options: AnalyzeOptions): TranscriptAudit {
  const toolNameById = new Map<string, string>();
  const parseErrors: string[] = [];
  const failures: ToolFailureRecord[] = [];
  const patternFailures: PatternFailureRecord[] = [];
  const mcpSequence: ToolCallRecord[] = [];
  const totalToolCallsByName: Record<string, number> = {};
  const mcpToolCallsByName: Record<string, number> = {};
  const uiAutomationCallsByName: Record<string, number> = {};
  const patternMatchers = createPatternMatchers(options.failurePatterns);
  let records = 0;
  let finalText: string | undefined;
  let resultSummary: Record<string, unknown> | undefined;

  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    if (!rawLine.trim()) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(rawLine) as unknown;
    } catch (error) {
      parseErrors.push(`line ${line}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!isRecord(entry)) {
      parseErrors.push(`line ${line}: expected JSON object`);
      continue;
    }

    records += 1;
    const timestamp = asString(entry.timestamp);
    const entryType = asString(entry.type);
    const lineText = rawLine.length > 600 ? `${rawLine.slice(0, 600)}…` : rawLine;

    for (const matcher of patternMatchers) {
      if (matcher.regex.test(rawLine)) {
        patternFailures.push({ pattern: matcher.pattern, line, excerpt: lineText });
      }
    }

    if (entryType === 'result') {
      resultSummary = entry;
      finalText = asString(entry.result) ?? finalText;
      if (entry.is_error === true) {
        failures.push({ line, message: finalText ?? 'Claude result reported an error' });
      }
      continue;
    }

    if (entryType === 'assistant') {
      for (const block of extractContentBlocks(entry)) {
        if (!isRecord(block)) continue;
        if (block.type === 'text') {
          finalText = asString(block.text) ?? finalText;
          continue;
        }
        if (block.type !== 'tool_use') continue;

        const fullName = asString(block.name);
        const id = asString(block.id);
        if (!fullName || !id) continue;

        toolNameById.set(id, fullName);
        incrementCount(totalToolCallsByName, fullName);

        const shortName = shortToolName(fullName);
        const isMcp = fullName.startsWith(options.mcpToolPrefix);
        const isUiAutomation = isMcp && UI_AUTOMATION_TOOLS.has(shortName);

        if (isMcp) {
          incrementCount(mcpToolCallsByName, shortName);
          const record: ToolCallRecord = {
            id,
            fullName,
            shortName,
            input: block.input,
            line,
            timestamp,
            isMcp,
            isUiAutomation,
          };
          mcpSequence.push(record);
        }

        if (isUiAutomation) {
          incrementCount(uiAutomationCallsByName, shortName);
        }
      }
      continue;
    }

    if (entryType === 'user') {
      for (const block of extractContentBlocks(entry)) {
        if (!isRecord(block) || block.type !== 'tool_result') continue;
        const id = asString(block.tool_use_id);
        const fullName = id ? toolNameById.get(id) : undefined;
        if (!fullName?.startsWith(options.mcpToolPrefix)) continue;

        const structured = extractStructuredResult(block, entry);
        if (!resultDidError(block, structured)) continue;

        failures.push({
          id,
          fullName,
          shortName: shortToolName(fullName),
          line,
          message: stringifyContent(block.content),
        });
      }
    }
  }

  return {
    records,
    parseErrors,
    totalToolCalls: Object.values(totalToolCallsByName).reduce((sum, count) => sum + count, 0),
    totalToolCallsByName,
    mcpToolCalls: mcpSequence.length,
    mcpToolCallsByName,
    uiAutomationCalls: Object.values(uiAutomationCallsByName).reduce(
      (sum, count) => sum + count,
      0,
    ),
    uiAutomationCallsByName,
    mcpSequence,
    failures,
    patternFailures,
    finalText,
    resultSummary,
  };
}
