import type { AnyFragment } from '../types/domain-fragments.ts';

/**
 * Convert a domain fragment into the public `--output jsonl` wire shape.
 *
 * The envelope is a single `event` discriminator derived mechanically from
 * the fragment's internal `kind` and `fragment` discriminators:
 *
 *     event = `<kind>.<fragment>` (lowercased)
 *
 * All remaining fields pass through unchanged so the public shape is a pure
 * projection of the domain model. New fragments surface automatically with
 * no mapping work — contributors only need to keep `kind` / `fragment`
 * discriminator values lowercase-kebab.
 */
export function toCliJsonlEvent(fragment: AnyFragment): Record<string, unknown> {
  const { kind, fragment: type, ...rest } = fragment;
  return { event: `${kind}.${type}`.toLowerCase(), ...rest };
}
