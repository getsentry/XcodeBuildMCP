import type { FileSystemExecutor } from './FileSystemExecutor.ts';

export interface DiscoveredTestCase {
  framework: 'xctest' | 'swift-testing';
  targetName: string;
  typeName?: string;
  methodName: string;
  displayName: string;
  line: number;
  parameterized: boolean;
}

export interface DiscoveredTestFile {
  path: string;
  tests: DiscoveredTestCase[];
}

interface SanitizerState {
  inBlockComment: boolean;
  inMultilineString: boolean;
}

function sanitizeLine(input: string, state: SanitizerState): string {
  let output = '';

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1] ?? '';
    const triple = input.slice(index, index + 3);

    if (state.inBlockComment) {
      if (current === '*' && next === '/') {
        state.inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (state.inMultilineString) {
      if (triple === '"""') {
        state.inMultilineString = false;
        index += 2;
      }
      continue;
    }

    if (triple === '"""') {
      state.inMultilineString = true;
      index += 2;
      continue;
    }

    if (current === '/' && next === '*') {
      state.inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      break;
    }

    if (current === '"') {
      output += ' ';
      index += 1;
      while (index < input.length) {
        if (input[index] === '\\') {
          index += 2;
          continue;
        }
        if (input[index] === '"') {
          break;
        }
        index += 1;
      }
      continue;
    }

    output += current;
  }

  return output;
}

function countBraces(line: string): number {
  let delta = 0;
  for (const character of line) {
    if (character === '{') {
      delta += 1;
    } else if (character === '}') {
      delta -= 1;
    }
  }
  return delta;
}

function countParentheses(line: string): number {
  let delta = 0;
  for (const character of line) {
    if (character === '(') {
      delta += 1;
    } else if (character === ')') {
      delta -= 1;
    }
  }
  return delta;
}

function collectXCTestTypes(lines: string[]): Set<string> {
  const xctestTypes = new Set<string>();

  for (const line of lines) {
    const typeMatch = line.match(
      /\b(?:final\s+)?(?:class|struct|actor)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^{]+)/,
    );
    if (!typeMatch) {
      continue;
    }

    const [, typeName, inheritanceClause] = typeMatch;
    if (inheritanceClause.includes('XCTestCase')) {
      xctestTypes.add(typeName);
    }
  }

  return xctestTypes;
}

function formatDisplayName(
  targetName: string,
  typeName: string | undefined,
  methodName: string,
): string {
  return `${targetName}/${typeName ?? 'Global'}/${methodName}`;
}

function discoverTestsInFileContent(
  targetName: string,
  filePath: string,
  content: string,
): DiscoveredTestFile | null {
  const rawLines = content.split(/\r?\n/);
  const sanitizerState: SanitizerState = {
    inBlockComment: false,
    inMultilineString: false,
  };
  const sanitizedLines = rawLines.map((line) => sanitizeLine(line, sanitizerState));
  const xctestTypes = collectXCTestTypes(sanitizedLines);
  const tests: DiscoveredTestCase[] = [];
  const scopeStack: Array<{ typeName?: string; xctestContext: boolean; depth: number }> = [];
  let braceDepth = 0;
  let pendingAttributes: string[] = [];
  let pendingMultilineAttributeIndex: number | null = null;
  let pendingAttributeParenthesisDepth = 0;

  sanitizedLines.forEach((sanitizedLine, index) => {
    const lineNumber = index + 1;
    const line = sanitizedLine.trim();

    while (scopeStack.length > 0 && braceDepth < scopeStack[scopeStack.length - 1].depth) {
      scopeStack.pop();
    }

    let consumedAttributeContinuation = false;

    if (line.startsWith('@')) {
      pendingAttributes.push(line);
      const parenthesisDepth = countParentheses(line);
      if (parenthesisDepth > 0) {
        pendingMultilineAttributeIndex = pendingAttributes.length - 1;
        pendingAttributeParenthesisDepth = parenthesisDepth;
      } else {
        pendingMultilineAttributeIndex = null;
        pendingAttributeParenthesisDepth = 0;
      }
    } else if (pendingMultilineAttributeIndex !== null) {
      pendingAttributes[pendingMultilineAttributeIndex] =
        `${pendingAttributes[pendingMultilineAttributeIndex]} ${line}`;
      pendingAttributeParenthesisDepth += countParentheses(line);
      consumedAttributeContinuation = true;
      if (pendingAttributeParenthesisDepth <= 0) {
        pendingMultilineAttributeIndex = null;
        pendingAttributeParenthesisDepth = 0;
      }
    }

    const typeMatch = line.match(
      /\b(?:final\s+)?(?:class|struct|actor)\s+([A-Za-z_][A-Za-z0-9_]*)\b(?:\s*:\s*([^{]+))?/,
    );
    const extensionMatch = line.match(/\bextension\s+([A-Za-z_][A-Za-z0-9_]*)\b/);

    if (typeMatch && line.includes('{')) {
      const typeName = typeMatch[1];
      const inheritanceClause = typeMatch[2] ?? '';
      scopeStack.push({
        typeName,
        xctestContext: xctestTypes.has(typeName) || inheritanceClause.includes('XCTestCase'),
        depth: braceDepth + Math.max(countBraces(line), 1),
      });
    } else if (extensionMatch && line.includes('{')) {
      const typeName = extensionMatch[1];
      scopeStack.push({
        typeName,
        xctestContext: xctestTypes.has(typeName),
        depth: braceDepth + Math.max(countBraces(line), 1),
      });
    }

    const functionMatch = line.match(/\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (functionMatch) {
      const methodName = functionMatch[1];
      const parameters = functionMatch[2].trim();
      const currentScope = scopeStack[scopeStack.length - 1];
      const hasTestAttribute = pendingAttributes.some((attribute) => attribute.startsWith('@Test'));

      if (currentScope?.xctestContext && methodName.startsWith('test') && parameters.length === 0) {
        tests.push({
          framework: 'xctest',
          targetName,
          typeName: currentScope.typeName,
          methodName,
          displayName: formatDisplayName(targetName, currentScope.typeName, methodName),
          line: lineNumber,
          parameterized: false,
        });
      } else if (hasTestAttribute) {
        tests.push({
          framework: 'swift-testing',
          targetName,
          typeName: currentScope?.typeName,
          methodName,
          displayName: formatDisplayName(targetName, currentScope?.typeName, methodName),
          line: lineNumber,
          parameterized: pendingAttributes.some((attribute) => attribute.includes('arguments:')),
        });
      }

      pendingAttributes = [];
      pendingMultilineAttributeIndex = null;
      pendingAttributeParenthesisDepth = 0;
    } else if (
      line.length > 0 &&
      !line.startsWith('@') &&
      !consumedAttributeContinuation &&
      pendingMultilineAttributeIndex === null
    ) {
      pendingAttributes = [];
    }

    braceDepth += countBraces(line);
    while (scopeStack.length > 0 && braceDepth < scopeStack[scopeStack.length - 1].depth) {
      scopeStack.pop();
    }
  });

  return tests.length > 0 ? { path: filePath, tests } : null;
}

export async function discoverSwiftTestsInFiles(
  targetName: string,
  filePaths: string[],
  fileSystemExecutor: FileSystemExecutor,
): Promise<DiscoveredTestFile[]> {
  const sortedPaths = [...filePaths].sort();
  const fileContents = await Promise.all(
    sortedPaths.map(async (filePath) => {
      try {
        const content = await fileSystemExecutor.readFile(filePath, 'utf8');
        return { filePath, content };
      } catch {
        return null;
      }
    }),
  );

  const discoveredFiles: DiscoveredTestFile[] = [];
  for (const entry of fileContents) {
    if (!entry) {
      continue;
    }
    const result = discoverTestsInFileContent(targetName, entry.filePath, entry.content);
    if (result) {
      discoveredFiles.push(result);
    }
  }

  return discoveredFiles;
}
