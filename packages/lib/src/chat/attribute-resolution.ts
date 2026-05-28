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

/**
 * Split a display name on the first whitespace.
 *
 * The Contact entity has no `name` / `full_name` write path — the NAME-typed
 * `fullName` field is read-direction only (composes "first last" for display)
 * and its Zod validator rejects strings. So we split into the two real text
 * columns ourselves. Single-word names land entirely in `first_name`.
 */
function splitName(name: string): { first_name?: string; last_name?: string } {
  const trimmed = name.trim()
  if (!trimmed) return {}
  const space = trimmed.search(/\s/)
  if (space === -1) return { first_name: trimmed }
  return {
    first_name: trimmed.slice(0, space),
    last_name: trimmed.slice(space + 1).trim() || undefined,
  }
}

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

  // OIDC-style name claims → Contact's first_name / last_name. Explicit
  // first_name / last_name in the input always win over derived values.
  const given = writes.given_name
  if (typeof given === 'string' && writes.first_name === undefined) {
    writes.first_name = given
  }
  delete writes.given_name

  const family = writes.family_name
  if (typeof family === 'string' && writes.last_name === undefined) {
    writes.last_name = family
  }
  delete writes.family_name

  const display = writes.name
  if (
    typeof display === 'string' &&
    (writes.first_name === undefined || writes.last_name === undefined)
  ) {
    const parts = splitName(display)
    if (writes.first_name === undefined && parts.first_name !== undefined) {
      writes.first_name = parts.first_name
    }
    if (writes.last_name === undefined && parts.last_name !== undefined) {
      writes.last_name = parts.last_name
    }
  }
  delete writes.name

  return { writes }
}
