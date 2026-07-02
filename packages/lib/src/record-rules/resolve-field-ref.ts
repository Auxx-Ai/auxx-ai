// packages/lib/src/record-rules/resolve-field-ref.ts
// Normalize a user-supplied field ref (row id OR systemAttribute) to the canonical
// CustomField row id for one entity definition — rules store the row id (FK).

import { getCachedCustomFields } from '../cache'
import { BadRequestError } from '../errors'

/**
 * Resolve `ref` against the def's cached fields by id or systemAttribute.
 * Throws BadRequestError when the field doesn't exist on the definition.
 */
export async function resolveFieldRefToId(
  organizationId: string,
  entityDefinitionId: string,
  ref: string
): Promise<string> {
  const fields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const field = fields.find((f) => f.id === ref || f.systemAttribute === ref)
  if (!field) {
    throw new BadRequestError(`Field '${ref}' not found on this definition`)
  }
  return field.id
}
