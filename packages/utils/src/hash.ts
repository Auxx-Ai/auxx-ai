// packages/utils/src/hash.ts

import { createHash } from 'node:crypto'
import { stableStringify } from './json'

/**
 * Stable SHA-256 (hex) of a value's canonical serialization. Key-order- and
 * insertion-order-independent, so the same logical value hashes identically
 * before and after a Postgres `jsonb` round-trip — see {@link stableStringify}.
 *
 * Server-only (`node:crypto`); intentionally NOT re-exported from the package
 * barrel so it can never leak into a browser bundle. Import it explicitly from
 * `@auxx/utils/hash`.
 */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}
