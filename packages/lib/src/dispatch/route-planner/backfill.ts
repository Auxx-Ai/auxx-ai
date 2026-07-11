// packages/lib/src/dispatch/route-planner/backfill.ts
//
// One-time geocode backfill (plans/dispatch/09-route-planner.md §I): work orders whose
// addresses were saved BEFORE the `geocodeOnAddressChange` hook existed have visit rows with
// null coordinates and therefore no map pin. This walks every ungeocoded visit, geocodes its
// work order's `work_order_address` once, and stamps the coords onto all of that work order's
// visit rows — the same quiet-UPDATE write the hook does. Safe to re-run (already-geocoded
// visits are excluded by the null-latitude filter). Called by
// `apps/worker/scripts/backfill-geocode-visits.ts`.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { geocode } from '../../geocoding'

const logger = createScopedLogger('dispatch:route-planner:backfill')

/** Mirrors the hook's `formatAddressForGeocode` (visit-hooks.ts) — same joined string in. */
function formatAddressForGeocode(value: Record<string, unknown>): string {
  const part = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '')
  return [
    part('street1'),
    part('street2'),
    part('city'),
    part('state'),
    part('zipCode'),
    part('country'),
  ]
    .filter(Boolean)
    .join(', ')
}

export interface BackfillGeocodeResult {
  ungeocodedVisits: number
  workOrders: number
  geocoded: number
  noAddress: number
  failed: number
}

/**
 * Geocode every work order with ungeocoded visit rows (optionally one org). One MapTiler call
 * per work order, throttled ~150ms apart (free-tier friendly). Requires `MAPTILER_API_KEY` —
 * without it `geocode()` resolves null and every row counts as `failed`, so callers should
 * check the env first.
 */
export async function backfillGeocodeVisits(
  organizationId?: string
): Promise<BackfillGeocodeResult> {
  const visits = await database
    .select({
      id: schema.WorkOrderVisit.id,
      organizationId: schema.WorkOrderVisit.organizationId,
      workOrderId: schema.WorkOrderVisit.workOrderId,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        isNull(schema.WorkOrderVisit.latitude),
        ...(organizationId ? [eq(schema.WorkOrderVisit.organizationId, organizationId)] : [])
      )
    )
  const result: BackfillGeocodeResult = {
    ungeocodedVisits: visits.length,
    workOrders: 0,
    geocoded: 0,
    noAddress: 0,
    failed: 0,
  }
  if (visits.length === 0) return result

  // Group by work order — one geocode per address, stamped onto all of its visit rows.
  const byWorkOrder = new Map<string, { organizationId: string; visitIds: string[] }>()
  for (const v of visits) {
    const entry = byWorkOrder.get(v.workOrderId) ?? {
      organizationId: v.organizationId,
      visitIds: [],
    }
    entry.visitIds.push(v.id)
    byWorkOrder.set(v.workOrderId, entry)
  }
  result.workOrders = byWorkOrder.size

  // Address field ids per org (system attribute `work_order_address`).
  const orgIds = Array.from(new Set(visits.map((v) => v.organizationId)))
  const addressFields = await database
    .select({ id: schema.CustomField.id, organizationId: schema.CustomField.organizationId })
    .from(schema.CustomField)
    .where(
      and(
        inArray(schema.CustomField.organizationId, orgIds),
        eq(schema.CustomField.systemAttribute, 'work_order_address')
      )
    )
  const addressFieldByOrg = new Map(addressFields.map((f) => [f.organizationId, f.id]))

  for (const [workOrderId, group] of byWorkOrder) {
    const fieldId = addressFieldByOrg.get(group.organizationId)
    if (!fieldId) {
      result.noAddress++
      continue
    }
    const [row] = await database
      .select({ valueJson: schema.FieldValue.valueJson })
      .from(schema.FieldValue)
      .where(
        and(eq(schema.FieldValue.entityId, workOrderId), eq(schema.FieldValue.fieldId, fieldId))
      )
      .limit(1)
    const address = row?.valueJson as Record<string, unknown> | null | undefined
    const line = address ? formatAddressForGeocode(address) : ''
    if (!line) {
      result.noAddress++
      continue
    }

    const geo = await geocode(line)
    if (!geo) {
      result.failed++
      logger.warn('Backfill geocode failed', { workOrderId, line })
      continue
    }
    await database
      .update(schema.WorkOrderVisit)
      .set({ latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date() })
      .where(inArray(schema.WorkOrderVisit.id, group.visitIds))
    result.geocoded++
    // Stay well under MapTiler's free-tier rate limit.
    await new Promise((r) => setTimeout(r, 150))
  }

  return result
}
