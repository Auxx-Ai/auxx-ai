// packages/lib/src/field-hooks/pre/subpart-service-guard.ts

import { database } from '@auxx/database'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { isServicePartKind } from '../../inventory/costing/client'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityPreCreateHandler } from '../types'

const PARENT_ATTR = 'subpart_parent_part'
const CHILD_ATTR = 'subpart_child_part'

/** Refuse a BOM line whose parent or component is a `service` (107-D10). Create only. */
export const guardSubpartServiceCreate: EntityPreCreateHandler = async (event) => {
  const fields = await getOrgCache()
    .from(event.organizationId, 'customFields')
    .bySystemAttributes([PARENT_ATTR, CHILD_ATTR] as const)

  // The patch is keyed by systemAttribute or by field id, whichever the caller used.
  const read = (attribute: string, fieldId: string | undefined) =>
    unwrapRelationId(event.values[attribute] ?? (fieldId ? event.values[fieldId] : undefined))
  const parentId = read(PARENT_ATTR, fields.subpart_parent_part?.id)
  const childId = read(CHILD_ATTR, fields.subpart_child_part?.id)
  const partIds = [parentId, childId].filter((id): id is string => !!id)
  if (partIds.length === 0) return

  const { readPartKinds } = await import('../../inventory/builds/build-queries')
  const kinds = await readPartKinds(database, event.organizationId, partIds)

  if (parentId && isServicePartKind(kinds.get(parentId))) {
    throw new BadRequestError('A service is not stocked, so it cannot have a bill of materials')
  }
  if (childId && isServicePartKind(kinds.get(childId))) {
    throw new BadRequestError('A service is not stocked, so it cannot be a component')
  }
}
