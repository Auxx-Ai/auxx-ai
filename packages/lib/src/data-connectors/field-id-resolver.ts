// packages/lib/src/data-connectors/field-id-resolver.ts
// Shared resolver: connector write-keys → concrete CustomField.id.
//
// A connector write-set / mapping keys a field by a "concrete key" that is
// EITHER a bare CustomField uuid OR a systemAttribute (for system fields like
// contact's email). `FieldValue.fieldId` is always the CustomField uuid, so both
// the contributing-marker stamp (entity-sink) and the un-manage reconcile
// (reconciliation) must map those keys back to the uuid before touching
// FieldValue rows. Centralized here so the two paths can never diverge.

import { getCachedCustomFields } from '../cache'
import { buildWriteKeyToFieldIdMap } from '../field-values/write-key-map'

/**
 * Build a `(writeKey → CustomField.id)` map for an entity definition from the
 * org field cache. Maps both the field's own id (uuid → uuid) and its
 * systemAttribute (systemAttribute → uuid). A key absent from the map has no
 * resolvable CustomField (deleted field / stale cache) and should be treated as
 * unresolvable by the caller.
 */
export async function buildWriteKeyToFieldId(
  orgId: string,
  entityDefinitionId: string
): Promise<Map<string, string>> {
  const fields = await getCachedCustomFields(orgId, entityDefinitionId)
  return buildWriteKeyToFieldIdMap(fields)
}
