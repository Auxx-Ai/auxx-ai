// packages/lib/src/ai/kopilot/capabilities/record-views/target.ts

import { findCachedResource } from '../../../../cache/org-cache-helpers'
import type { Resource } from '../../../../resources/registry/types'
import { findRef } from '../../context-refs'
import type { SessionContext } from '../../types'

export interface RecordViewTarget {
  resource: Resource
  entityDefinitionId: string
  /** Dynamic-table store key for this entity's table — `entity-<entityDefinitionId>`. */
  tableId: string
}

/**
 * Resolve which records table the user is looking at from the page's `resource`
 * session ref (emitted by `<KopilotContext page="records" resource=…>`). The
 * records page is single-entity, so the entity is unambiguous and never taken
 * from the model.
 */
export async function resolveRecordViewTarget(
  ctx: SessionContext,
  organizationId: string
): Promise<RecordViewTarget | { error: string }> {
  const ref = findRef(ctx, 'resource')
  if (!ref) {
    return {
      error:
        'No active records table. Open a records page (e.g. Contacts, Companies, or a custom entity) first, then ask again.',
    }
  }

  const resource = await findCachedResource(organizationId, ref.id)
  if (!resource) {
    return { error: `The records table for "${ref.label ?? ref.id}" could not be found.` }
  }

  const entityDefinitionId = resource.entityDefinitionId ?? resource.id
  return { resource, entityDefinitionId, tableId: `entity-${entityDefinitionId}` }
}
