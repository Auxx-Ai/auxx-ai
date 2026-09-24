// packages/lib/src/field-hooks/pre/part-kind-service-guard.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { isServicePartKind } from '../../inventory/costing/client'
import {
  readServiceKindBlockers,
  serviceKindRefusal,
} from '../../inventory/costing/service-kind-blockers'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { FieldPreHookHandler } from '../types'

/** Refuse switching a part to `service` once it has stock movements, builds or a BOM (107 F3). */
export const guardPartKindService: FieldPreHookHandler = async (event) => {
  const kind = unwrapStatusValue(event.newValue)
  if (typeof kind !== 'string' || !isServicePartKind(kind)) return event.newValue

  const { entityInstanceId } = parseRecordId(event.recordId)
  const blockers = await readServiceKindBlockers(database, event.organizationId, [entityInstanceId])
  const reason = blockers.get(entityInstanceId)
  if (reason) throw new BadRequestError(serviceKindRefusal(reason))
  return event.newValue
}
