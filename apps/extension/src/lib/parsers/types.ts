// apps/extension/src/lib/parsers/types.ts

/**
 * Shared output shape for every per-host parser. The iframe React app
 * consumes this directly; field mapping into our resource registry happens
 * at save time inside `iframe/app.tsx`.
 */

export type ParsedPerson = {
  firstName?: string
  lastName?: string
  /** Used only when first/last cannot be split. */
  fullName?: string
  primaryEmail?: string
  phone?: string
  avatarUrl?: string
  /**
   * Optional data/blob URL used only for the in-iframe preview card. Set by
   * parsers whose host CDN rejects cross-origin img loads (e.g. Instagram's
   * fbcdn — Referer/session-scoped signed URLs). The remote `avatarUrl` is
   * still threaded to the server-side upload path; this one just renders.
   */
  avatarPreviewUrl?: string
  /** Bio text, job title concat, or any free-text the parser surfaces. */
  notes?: string
  /** e.g. 'linkedin:markus-klooth'. Always present. */
  externalId: string
  /**
   * X/Twitter follower count. Captured on profile parses; carried here so
   * the secondary "Save as company" flow can thread it to the company field
   * via personToCompany. Undefined for non-X parses.
   */
  xFollowerCount?: number
}

export type ParsedCompany = {
  name?: string
  domain?: string
  avatarUrl?: string
  /** See ParsedPerson.avatarPreviewUrl. */
  avatarPreviewUrl?: string
  notes?: string
  externalId: string
  /** X/Twitter follower count on company/brand accounts. */
  xFollowerCount?: number
}

export type ParseResult = {
  people: ParsedPerson[]
  companies: ParsedCompany[]
}

export const EMPTY_PARSE_RESULT: ParseResult = { people: [], companies: [] }

/**
 * Split a full name on whitespace. First token → firstName, rest → lastName.
 * Single-token names collapse to `firstName` only; empty input yields `{}`.
 */
export function splitName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}
