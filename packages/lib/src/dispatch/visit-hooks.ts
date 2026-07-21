// packages/lib/src/dispatch/visit-hooks.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import type { AddressNormalizedListener } from '../geocoding/address-normalize-hook'
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

/**
 * Pin a work order's visit rows the instant its address geocodes (create AND update — route
 * planner build contract item 8, amending 02 §6's original "geocode at schedule time" to
 * "geocode at address-set time": unscheduled backlog jobs need pins too). Registered as an
 * address-normalized LISTENER (`registerAddressNormalizedListener`, wired in
 * `field-hooks/register-hooks.ts`), not a field-change hook: the ADDRESS_STRUCT normalize hook
 * (`geocoding/address-normalize-hook.ts`) already geocodes every address write server-side, so
 * this rides its result instead of making a second MapTiler call per write (plans/address-field
 * §9 follow-up 2). The normalize chain runs fire-and-forget off the save request, so pins land
 * moments after the save response — same visibility contract as before: no broadcast, the next
 * board/map refetch picks them up.
 *
 * Writes `latitude`/`longitude`/`geocodedAt` directly onto ALL of that work order's visit rows
 * via a quiet Drizzle `UPDATE` — deliberately NOT through `afterVisitWrite` (geocoding isn't a
 * schedule mutation; no mirror/roll-up/broadcast needed). A failed geocode or missing
 * `MAPTILER_API_KEY` never reaches this listener — the visit(s) just stay unpinned.
 */
export const syncVisitPinsOnAddressNormalized: AddressNormalizedListener = async (
  event,
  struct
) => {
  if (event.field.systemAttribute !== 'work_order_address') return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await database
    .update(schema.WorkOrderVisit)
    .set({ latitude: struct.lat, longitude: struct.lng, geocodedAt: new Date() })
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, event.organizationId),
        eq(schema.WorkOrderVisit.workOrderId, entityInstanceId)
      )
    )
}
