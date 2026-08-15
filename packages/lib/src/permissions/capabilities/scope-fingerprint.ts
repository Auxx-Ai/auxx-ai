// packages/lib/src/permissions/capabilities/scope-fingerprint.ts

/**
 * FNV-1a over a pre-sorted, pre-joined id list — the shared digest behind every
 * **viewer dimension** added to an org-keyed result cache key.
 *
 * Not a security boundary: enforcement is always the SQL predicate the same
 * scope produced, and this only decides which cache entry that predicate's
 * results land in. It exists because the picker's list cache is keyed by
 * `(orgId, table, {cursor, search, filters})` with no user dimension at all, so
 * any viewer-dependent narrowing MUST extend the key or one member's page is
 * served to another — in both directions.
 *
 * Callers sort before joining so two principals with identical access always
 * produce the same key regardless of map iteration order. That is what keeps the
 * hit rate up: nearly everyone in an org composes the same scope, so they keep
 * sharing one entry.
 *
 * ⚠ The 32-bit collision risk is the one accepted in
 * {@link import('./article-visibility-scope').knowledgeBaseScopeFingerprint} —
 * read the analysis there before reusing this for a scope whose domain is
 * per-USER rather than per-access-shape, which would change the collision count
 * from "distinct access shapes an admin authored" to "headcount".
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}
