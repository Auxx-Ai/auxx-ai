// packages/lib/src/dispatch/visit-hooks.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { geocode } from '../geocoding'
import { ensureVisitForWorkOrder } from './visit-mutations'

/**
 * Auto-create the unscheduled visit row when a work order is created (any path:
 * generic record.create, createFromTicket, Kopilot tools, workflows). Keyed off the
 * first write of work_order_number — hook-generated exactly once per create (§F.4a),
 * since that field is creatable:false/updatable:false everywhere else.
 */
export const ensureVisitOnWorkOrderCreate: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'work_order_number') return
  if (event.oldValue !== null) return // not the create write
  const { entityInstanceId } = parseRecordId(event.recordId)
  await ensureVisitForWorkOrder(event.organizationId, entityInstanceId)
}

/** Single-line join of an `AddressStruct` JSON value — geocoder input, not a display formatter. */
function formatAddressForGeocode(value: Record<string, unknown>): string {
  const part = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '')
  const parts = [
    part('street1'),
    part('street2'),
    part('city'),
    part('state'),
    part('zipCode'),
    part('country'),
  ]
  return parts.filter(Boolean).join(', ')
}

/**
 * Geocode a work order's address the instant it's set (create AND update — route planner
 * build contract item 8, amending 02 §6's original "geocode at schedule time" to "geocode at
 * address-set time": unscheduled backlog jobs need pins too). Keyed off `work_order_address`
 * (ADDRESS_STRUCT); no `oldValue === null` gate, unlike {@link ensureVisitOnWorkOrderCreate} —
 * the service address can change after creation and must re-geocode every time.
 *
 * Writes `latitude`/`longitude`/`geocodedAt` directly onto ALL of that work order's visit rows
 * via a quiet Drizzle `UPDATE` — deliberately NOT through `afterVisitWrite` (geocoding isn't a
 * schedule mutation; no mirror/roll-up/broadcast needed, the next board/map refetch picks it
 * up). Failure or a missing `MAPTILER_API_KEY` is non-fatal — `geocode()` never throws, so a
 * `null` result just leaves the visit(s) unpinned.
 */
export const geocodeOnAddressChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'work_order_address') return

  const addressValue = event.newValue as Record<string, unknown> | null
  if (!addressValue) return

  const line = formatAddressForGeocode(addressValue)
  const result = await geocode(line)
  if (!result) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await database
    .update(schema.WorkOrderVisit)
    .set({ latitude: result.lat, longitude: result.lng, geocodedAt: new Date() })
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, event.organizationId),
        eq(schema.WorkOrderVisit.workOrderId, entityInstanceId)
      )
    )
}
