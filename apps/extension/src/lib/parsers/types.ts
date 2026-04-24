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
  /** Bio text, job title concat, or any free-text the parser surfaces. */
  notes?: string
  /** e.g. 'linkedin:markus-klooth'. Always present. */
  externalId: string
}

export type ParsedCompany = {
  name?: string
  domain?: string
  avatarUrl?: string
  notes?: string
  externalId: string
}

export type ParseResult = {
  people: ParsedPerson[]
  companies: ParsedCompany[]
}

export const EMPTY_PARSE_RESULT: ParseResult = { people: [], companies: [] }
