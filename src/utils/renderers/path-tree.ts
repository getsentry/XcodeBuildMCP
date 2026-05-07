export interface PathTreeEntry {
  path: string;
  label?: string;
}

export interface PathTreeFormatOptions {
  formatPath?: (path: string) => string;
}

interface PathTreeNode {
  name: string;
  rawPath: string;
  children: Map<string, PathTreeNode>;
  label?: string;
}

interface ParsedPath {
  components: string[];
  sortablePath: string;
  label?: string;
}

function normalizeRawPath(inputPath: string): string {
  const normalized = inputPath.replace(/\/+/g, '/');
  return normalized === '/' ? normalized : normalized.replace(/\/$/, '');
}

function parseRawPath(entry: PathTreeEntry): ParsedPath | null {
  const normalized = normalizeRawPath(entry.path.trim());
  if (normalized.length === 0) {
    return null;
  }

  if (normalized === '/') {
    return { components: ['/'], sortablePath: normalized, label: entry.label };
  }

  const isAbsolute = normalized.startsWith('/');
  const segments = (isAbsolute ? normalized.slice(1) : normalized).split('/').filter(Boolean);
  const components = isAbsolute ? ['/', ...segments] : segments;
  return { components, sortablePath: normalized, label: entry.label };
}

function createNode(name: string, rawPath: string): PathTreeNode {
  return { name, rawPath, children: new Map() };
}

function childRawPath(parentRawPath: string, component: string): string {
  if (component === '/') {
    return '/';
  }
  if (parentRawPath === '' || parentRawPath === '/') {
    return `${parentRawPath}${component}`;
  }
  return `${parentRawPath}/${component}`;
}

function addPath(root: PathTreeNode, parsedPath: ParsedPath): void {
  let node = root;
  for (const component of parsedPath.components) {
    const existing = node.children.get(component);
    if (existing) {
      node = existing;
    } else {
      const child = createNode(component, childRawPath(node.rawPath, component));
      node.children.set(component, child);
      node = child;
    }
  }
  node.label = parsedPath.label;
}

function relativeRawPath(fromPath: string, toPath: string): string {
  if (fromPath === '/') {
    return toPath.startsWith('/') ? toPath.slice(1) : toPath;
  }
  if (toPath === fromPath) {
    return '';
  }
  if (toPath.startsWith(`${fromPath}/`)) {
    return toPath.slice(fromPath.length + 1);
  }
  return toPath;
}

function appendDirectorySlash(name: string, hasChildren: boolean): string {
  return hasChildren && !name.endsWith('/') ? `${name}/` : name;
}

function formatLeaf(node: PathTreeNode, displayName: string): string {
  return node.label ? `${displayName} — ${node.label}` : displayName;
}

function flattenSingleChildChain(node: PathTreeNode): PathTreeNode {
  let current = node;
  while (current.children.size === 1 && current.label === undefined) {
    const onlyChild = current.children.values().next().value;
    if (!onlyChild) break;
    current = onlyChild;
  }
  return current;
}

function renderNode(
  node: PathTreeNode,
  prefix: string,
  isLast: boolean,
  parentRawPath: string | undefined,
  formatPath: (path: string) => string,
): string[] {
  const flattened = flattenSingleChildChain(node);
  const displayName = appendDirectorySlash(
    parentRawPath === undefined
      ? formatPath(flattened.rawPath)
      : relativeRawPath(parentRawPath, flattened.rawPath),
    flattened.children.size > 0,
  );
  const branch = isLast ? '└── ' : '├── ';
  const lines = [`${prefix}${branch}${formatLeaf(flattened, displayName)}`];
  const children = [...flattened.children.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const childPrefix = `${prefix}${isLast ? '    ' : '│   '}`;

  children.forEach((child, index) => {
    lines.push(
      ...renderNode(
        child,
        childPrefix,
        index === children.length - 1,
        flattened.rawPath,
        formatPath,
      ),
    );
  });

  return lines;
}

function topLevelNodes(root: PathTreeNode): PathTreeNode[] {
  const children = [...root.children.values()];
  const onlyChild = children.length === 1 ? children[0] : undefined;
  if (onlyChild && onlyChild.name === '/' && onlyChild.children.size > 1) {
    return [...onlyChild.children.values()];
  }
  return children;
}

export function formatPathTree(
  entries: readonly PathTreeEntry[],
  options: PathTreeFormatOptions = {},
): string[] {
  const formatPath = options.formatPath ?? ((path: string): string => path);
  const root = createNode('', '');
  const parsedPaths = entries
    .map(parseRawPath)
    .filter((entry): entry is ParsedPath => entry !== null)
    .sort((left, right) => left.sortablePath.localeCompare(right.sortablePath));

  for (const parsedPath of parsedPaths) {
    addPath(root, parsedPath);
  }

  const nodes = topLevelNodes(root).sort((left, right) =>
    left.rawPath.localeCompare(right.rawPath),
  );
  return nodes.flatMap((child, index) =>
    renderNode(child, '', index === nodes.length - 1, undefined, formatPath),
  );
}
