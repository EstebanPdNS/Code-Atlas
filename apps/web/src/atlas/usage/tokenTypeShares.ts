import type { ShareSegment } from "../../components/usage/UsageShareBar";

export interface TokenTypeShare extends ShareSegment {
  /** This type's part of all shown token types, from 0 to 1. */
  readonly share: number;
}

/**
 * Code Atlas: the token types that have tokens, each with its share of their
 * sum, in the order given. Empty when no type has tokens.
 */
export function tokenTypeShares(segments: readonly ShareSegment[]): readonly TokenTypeShare[] {
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return [];
  return visible.map((segment) => ({ ...segment, share: segment.value / total }));
}
