// packages/lib/src/chat/attribute-resolution.ts

/**
 * JWT claim names that are never written as generic Contact attributes.
 *
 * - `user_id` is resolved upstream into the Contact's multi-value
 *   `external_id` (as `chat:<user_id>`).
 * - `email` is written to `Contact.primary_email`.
 * - `exp`, `iat`, `nbf`, `iss`, `aud`, `sub` are JWT framing.
 */
const RESERVED_CLAIMS = new Set(['user_id', 'email', 'exp', 'iat', 'nbf', 'iss', 'aud', 'sub'])

export interface ResolveChatAttributesInput {
  /** Attributes promoted out of a verified JWT — authoritative on conflict. */
  jwtClaims?: Record<string, unknown>
  /** Best-effort attributes supplied via `Auxx.boot({ attributes })`. */
  bootAttributes?: Record<string, unknown>
}

export interface ResolveChatAttributesResult {
  /** Final attribute map ready for the contact write path. */
  writes: Record<string, unknown>
}

/**
 * Merge JWT-verified (sensitive) attributes with `Auxx.boot()`-supplied
 * (non-sensitive) attributes into a single write map.
 *
 * Rules:
 *
 * 1. Reserved JWT claim names are stripped from both sides — they are not
 *    generic Contact attributes (see {@link RESERVED_CLAIMS}).
 * 2. On same-key conflict, the JWT value wins; the boot copy is dropped
 *    silently. v4 does not record conflicts to an audit table.
 * 3. Keys present only on one side are written as-is.
 */
export function resolveChatAttributes(
  input: ResolveChatAttributesInput
): ResolveChatAttributesResult {
  const writes: Record<string, unknown> = {}

  if (input.bootAttributes) {
    for (const [key, value] of Object.entries(input.bootAttributes)) {
      if (RESERVED_CLAIMS.has(key)) continue
      writes[key] = value
    }
  }

  if (input.jwtClaims) {
    for (const [key, value] of Object.entries(input.jwtClaims)) {
      if (RESERVED_CLAIMS.has(key)) continue
      writes[key] = value
    }
  }

  return { writes }
}
