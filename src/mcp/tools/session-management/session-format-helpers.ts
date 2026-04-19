import { sessionDefaultKeys } from '../../../utils/session-defaults-schema.ts';
import type { SessionDefaults } from '../../../utils/session-store.ts';

export function formatProfileLabel(profile: string | null): string {
  return profile ?? '(default)';
}

export function formatProfileAnnotation(profile: string | null): string {
  if (profile === null) {
    return '(default profile)';
  }
  return `(${profile} profile)`;
}

export function buildFullDetailTree(
  defaults: SessionDefaults,
): Array<{ label: string; value: string }> {
  return sessionDefaultKeys.map((key) => {
    const raw = defaults[key];
    const value = raw !== undefined ? String(raw) : '(not set)';
    return { label: key, value };
  });
}

export function formatDetailLines(items: Array<{ label: string; value: string }>): string[] {
  return items.map((item, index) => {
    const branch = index === items.length - 1 ? '\u2514' : '\u251C';
    return `${branch} ${item.label}: ${item.value}`;
  });
}
