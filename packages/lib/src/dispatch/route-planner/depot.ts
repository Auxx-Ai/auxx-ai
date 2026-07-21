// packages/lib/src/dispatch/route-planner/depot.ts
//
// Route-start (depot) resolution (plans/dispatch/09-route-planner.md §B, build contract item
// 5). v1 is outbound-only from the org's business address, geocoded once and cached in the
// `documents.businessGeocode` setting; `worker.homeBase` is read but not yet used — a
// documented no-op seam for a later per-worker depot (decision #6).

import { createHash } from 'node:crypto'
import { formatAddressForGeocode } from '@auxx/utils/address'
import { resolveDocumentSettings } from '../../documents'
import { geocode } from '../../geocoding'
import { getOrganizationSetting, updateOrganizationSetting } from '../../settings'
import type { DispatchWorkerWithUser } from '../workers'
import type { LatLng } from './types'

/** Sorted-key JSON hash — never hash unsorted JSON (standing repo lesson: jsonb reorders keys). */
function hashSortedJson(value: Record<string, unknown>): string {
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = value[key]
      return acc
    }, {})
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex')
}

interface BusinessGeocodeCache {
  lat: number
  lng: number
  geocodedAt: string
  addressHash: string
}

/**
 * Resolve the org's depot point (contract item 5, design doc decision #6): the org's business
 * address (`resolveDocumentSettings`), geocoded once and cached in the `documents.businessGeocode`
 * setting, re-geocoded lazily when the address hash changes → `null` when the org has no business
 * address. Org-level (no worker param) — this is the single depot both the planner board payload
 * (`planner-board.ts`) and per-worker route resolution (`resolveRouteStart`) resolve from.
 */
export async function resolveOrgDepot(organizationId: string): Promise<LatLng | null> {
  const { business } = await resolveDocumentSettings(organizationId)
  if (!business.address) return null

  const addressHash = hashSortedJson(business.address as unknown as Record<string, unknown>)
  const cached = (await getOrganizationSetting({
    organizationId,
    key: 'documents.businessGeocode',
  })) as BusinessGeocodeCache | null

  if (cached && cached.addressHash === addressHash) {
    return { lat: cached.lat, lng: cached.lng }
  }

  const line = formatAddressForGeocode(business.address)
  const result = await geocode(line)
  if (!result) return null

  const value: BusinessGeocodeCache = {
    lat: result.lat,
    lng: result.lng,
    geocodedAt: new Date().toISOString(),
    addressHash,
  }
  await updateOrganizationSetting({ organizationId, key: 'documents.businessGeocode', value })

  return result
}

/**
 * Resolve the depot (route-start/end point) for a worker's route (contract item 5, design doc
 * decision #6): `worker.homeBase` (future per-worker depot seam, not read in v1) → delegates to
 * {@link resolveOrgDepot} — the worker param stays for that documented future seam and for
 * callers that already resolve a worker (`directions.ts`).
 */
export async function resolveRouteStart(
  organizationId: string,
  worker: DispatchWorkerWithUser
): Promise<LatLng | null> {
  // Seam: `worker.homeBase` (ADDRESS_STRUCT, DispatchWorker schema) is the future per-worker
  // depot. v1 does not read it — org address only (decision #6).
  void worker.homeBase

  return resolveOrgDepot(organizationId)
}
