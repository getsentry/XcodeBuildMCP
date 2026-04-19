export function nullifyEmptyStrings(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(copy)) {
      const v = copy[key];
      if (typeof v === 'string' && v.trim() === '') copy[key] = undefined;
    }
    return copy;
  }
  return value;
}
