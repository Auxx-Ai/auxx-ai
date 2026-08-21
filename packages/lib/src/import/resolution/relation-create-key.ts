// packages/lib/src/import/resolution/relation-create-key.ts

import type { RelationCreateRequest } from '../types/resolution'

/**
 * The identity of a to-be-created relation target.
 *
 * In-file dedup lives here and nowhere else. One `ImportValueResolution`
 * row already covers all N cells carrying the same string in ONE column, 500
 * rows saying "Acme" share a row for free, but two different columns (or two
 * spellings, `Acme` and `ACME`) produce two rows pointing at the same intended
 * company. Keying on the normalized value across the whole job collapses those
 * too, so the preview count and the number of records minted are the same
 * number by construction.
 *
 * Lowercased because relation matching itself is case-insensitive: if `ACME`
 * would have MATCHED a stored `Acme`, then `ACME` and `Acme` in one file must
 * not create two companies.
 */
export function relationCreateKey(request: RelationCreateRequest): string {
  return `${request.entityDefinitionId}::${request.matchField}::${request.value.trim().toLowerCase()}`
}
