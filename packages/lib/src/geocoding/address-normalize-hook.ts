// packages/lib/src/geocoding/address-normalize-hook.ts
//
// Server-side geocoder normalization for ADDRESS_STRUCT field writes
// (plans/address-field/01-single-input-address-field.md §5 item 3, decision #5). Registered as
// a field-type-keyed post-write hook (decision #13, `field-hooks/registry.ts`), so it runs for
// every ADDRESS_STRUCT field on every entity — not just `work_order_address`. Feature modules
// that need the geocode result (dispatch visit pins) subscribe via
// {@link registerAddressNormalizedListener} instead of geocoding again themselves — this is THE
// one MapTiler call per address write (§9 follow-up 2 retired the v1 double-geocode).
//
// Field-change post-hooks are awaited inline in the save request
// (`field-values/field-value-mutations.ts`), so this handler itself does only cheap synchronous
// guards and returns fast; the geocode + write-back run fire-and-forget (an un-awaited promise
// with its own try/catch) so the save response never waits on MapTiler.

import { createScopedLogger } from '@auxx/logger'
import { extractValue, type TypedFieldValue } from '@auxx/types'
import type { FieldId } from '@auxx/types/field'
import { type AddressStructValue, formatAddressForGeocode } from '@auxx/utils/address'
import { stableHash } from '@auxx/utils/hash'
import type { EntityFieldChangeEvent, EntityFieldChangeHandler } from '../field-hooks/types'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { buildPublishEntry, setValueWithBuiltIn } from '../field-values/field-value-mutations'
import { getValue } from '../field-values/field-value-queries'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'
import { parseRecordId, toRecordId } from '../resources/resource-id'
import { geocodeStructured } from './geocoder'
import type { GeocodeStructuredResult } from './types'

const logger = createScopedLogger('geocoding')

/** Struct's locality confidence threshold for the `'single'` merge mode (decision #11). */
const RELEVANCE_THRESHOLD = 0.8

/** The six stored `AddressStruct` components — used for the idempotence-guard hash and the
 * "is this struct non-empty" check. Deliberately excludes `raw`/`lat`/`lng`/`geocodedAt`/
 * `_source` (transient/enrichment keys, not address content). */
const ADDRESS_COMPONENT_KEYS = [
  'street1',
  'street2',
  'city',
  'state',
  'zipCode',
  'country',
] as const

type AddressStructLike = Record<string, unknown>

/** Extract the plain struct object out of the event's typed value (scalar JSON field — never
 * array-return — but tolerate an array shape defensively, matching visit-hooks.ts's pattern). */
function extractStruct(value: unknown): AddressStructLike | null {
  const typed = value as TypedFieldValue | TypedFieldValue[] | null
  const first = Array.isArray(typed) ? typed[0] : typed
  if (!first) return null
  const extracted = extractValue(first)
  return extracted && typeof extracted === 'object' && !Array.isArray(extracted)
    ? (extracted as AddressStructLike)
    : null
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0
}

function isNonEmptyStruct(struct: AddressStructLike | null): struct is AddressStructLike {
  if (!struct) return false
  return ADDRESS_COMPONENT_KEYS.some((key) => !isBlank(struct[key]))
}

/** Sorted-key hash of just the address components — used to detect "nothing actually changed"
 * between `oldValue`/`newValue` (see the idempotence guard below). Mirrors depot.ts's
 * `hashSortedJson` pattern via the shared `stableHash` (sorted-key JSON, jsonb-safe). */
function componentHash(struct: AddressStructLike): string {
  const components: Record<string, unknown> = {}
  for (const key of ADDRESS_COMPONENT_KEYS) components[key] = struct[key] ?? ''
  return stableHash(components)
}

function stripSource(struct: AddressStructLike): AddressStructLike {
  if (!('_source' in struct)) return struct
  const next = { ...struct }
  delete next._source
  return next
}

/** Struct delivered to normalized-address listeners — the stored components plus a guaranteed
 * geocode stamp. */
export type NormalizedAddressStruct = Partial<AddressStructValue> & { lat: number; lng: number }

/** Fired once the hook has coordinates for a write — either freshly geocoded (after the quiet
 * write-back landed) or already stamped on the incoming struct (idempotence-guard path, where
 * no geocode runs). Never fired when the geocoder fails/no-ops — consumers just see no update. */
export type AddressNormalizedListener = (
  event: EntityFieldChangeEvent,
  struct: NormalizedAddressStruct
) => Promise<void> | void

const normalizedListeners: AddressNormalizedListener[] = []

/**
 * Subscribe to address normalizations. Feature modules that need the geocode result (dispatch
 * visit pins, `field-hooks/register-hooks.ts`) register here instead of making a second MapTiler
 * call per write. The subscription direction keeps this module free of feature imports — dispatch
 * already imports geocoding, so the reverse would cycle.
 */
export function registerAddressNormalizedListener(listener: AddressNormalizedListener): void {
  normalizedListeners.push(listener)
}

/** Fan the geocoded struct out to listeners, each isolated — a listener failure is logged and
 * never affects the others or the caller. No-op unless the struct carries numeric coordinates. */
async function notifyAddressNormalized(
  event: EntityFieldChangeEvent,
  struct: AddressStructLike
): Promise<void> {
  if (typeof struct.lat !== 'number' || typeof struct.lng !== 'number') return
  for (const listener of normalizedListeners) {
    try {
      await listener(event, struct as NormalizedAddressStruct)
    } catch (error) {
      logger.error('Address normalized listener failed', {
        recordId: event.recordId,
        fieldId: event.field.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Post-write hook for ADDRESS_STRUCT fields (registered field-type-keyed, not entity-scoped —
 * fires for every ADDRESS_STRUCT field regardless of entity). Bails fast on cheap synchronous
 * guards; the geocode + quiet write-back are fire-and-forget so the save request never blocks
 * on MapTiler (decision #5).
 */
export const normalizeAddressOnChange: EntityFieldChangeHandler = async (event) => {
  const newStruct = extractStruct(event.newValue)
  if (!isNonEmptyStruct(newStruct)) return

  // Idempotence/recursion guard: skip when this write already carries a stamped geocode AND its
  // address components are unchanged from the pre-write value — a no-op resave (or, defensively,
  // this hook's own write-back re-firing, though `publishEvents: false` on that write already
  // prevents that structurally). Compares directly against `event.oldValue`/`newValue`, already
  // on the event — no extra struct key/storage needed.
  const hasStampedGeo =
    typeof newStruct.lat === 'number' &&
    typeof newStruct.lng === 'number' &&
    typeof newStruct.geocodedAt === 'string'
  if (hasStampedGeo) {
    const oldStruct = extractStruct(event.oldValue)
    if (oldStruct && componentHash(oldStruct) === componentHash(newStruct)) {
      // Nothing to geocode, but listeners (visit pins) still get the already-stamped coords —
      // a no-op resave used to re-pin through dispatch's own geocode hook, and this keeps that
      // robustness for one cheap UPDATE. Fire-and-forget; notify never rejects (per-listener
      // catch), so a bare void is safe.
      void notifyAddressNormalized(event, newStruct)
      return
    }
  }

  void runNormalize(event, newStruct).catch((error) => {
    logger.error('Address normalize hook failed', {
      recordId: event.recordId,
      fieldId: event.field.id,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

async function runNormalize(
  event: EntityFieldChangeEvent,
  struct: AddressStructLike
): Promise<void> {
  const source = typeof struct._source === 'string' ? struct._source : undefined

  const geocoded = await geocodeStructured(
    formatAddressForGeocode(struct as unknown as Partial<AddressStructValue>)
  )

  if (!geocoded) {
    // Geocoder unavailable/no match — the parsed/typed value stands (§5 item 3's last bullet).
    // `_source` is a transient marker (decision #11/§5 item 4) that must never linger in
    // storage, though, so still strip it when present — cheapest correct write: skip the write
    // entirely when there's nothing to strip.
    if (source !== undefined) {
      await writeBack(event, struct, stripSource(struct))
    }
    return
  }

  const merged = mergeAddress(struct, geocoded, source)
  if (await writeBack(event, struct, merged)) {
    await notifyAddressNormalized(event, merged)
  }
}

/**
 * Merge policy (decision #11), keyed off the transient `_source` marker (§5 item 4):
 * - `'single'`: canonical city/state/zipCode/country from MapTiler at relevance >= 0.8, plus
 *   lat/lng/geocodedAt; clears `raw` on that high-relevance merge. Below threshold, lat/lng/
 *   geocodedAt only.
 * - `'structured'`: lat/lng/geocodedAt only — the structured editor is authoritative.
 * - no marker (Kopilot/workflows/connectors): fills only BLANK locality components (city/state/
 *   zipCode/country), plus lat/lng/geocodedAt.
 *
 * `street1`/`street2` are NEVER touched in any mode — local parse/user input owns the street
 * line; the geocoder owns locality. `_source` is always stripped from the result.
 */
function mergeAddress(
  struct: AddressStructLike,
  geocoded: GeocodeStructuredResult,
  source: string | undefined
): AddressStructLike {
  const merged = stripSource(struct)
  merged.lat = geocoded.lat
  merged.lng = geocoded.lng
  merged.geocodedAt = new Date().toISOString()

  const highRelevance = geocoded.relevance >= RELEVANCE_THRESHOLD

  if (source === 'single') {
    if (highRelevance) {
      if (geocoded.components.city) merged.city = geocoded.components.city
      if (geocoded.components.state) merged.state = geocoded.components.state
      if (geocoded.components.zipCode) merged.zipCode = geocoded.components.zipCode
      if (geocoded.components.country) merged.country = geocoded.components.country
      delete merged.raw
    }
  } else if (source === 'structured') {
    // lat/lng/geocodedAt only — already applied above, components untouched.
  } else {
    // No origin marker (Kopilot, workflows, connectors): fill only BLANK locality components.
    if (isBlank(merged.city) && geocoded.components.city) merged.city = geocoded.components.city
    if (isBlank(merged.state) && geocoded.components.state) merged.state = geocoded.components.state
    if (isBlank(merged.zipCode) && geocoded.components.zipCode) {
      merged.zipCode = geocoded.components.zipCode
    }
    if (isBlank(merged.country) && geocoded.components.country) {
      merged.country = geocoded.components.country
    }
  }

  return merged
}

/**
 * Write the normalized struct back QUIETLY: `setValueWithBuiltIn` with `publishEvents: false`
 * skips the field-change post-hook chain (so this can never re-fire itself), field triggers, and
 * the inline realtime publish — no timeline entry, no hook re-fire, no event storm. A skip-events
 * write does not bump `EntityInstance.updatedAt`; acceptable here (normalization is not a user
 * edit). We then publish the realtime update ourselves so open drawers pick up the canonical
 * struct — publishing the FULL composed value, since a value-less realtime publish is silently
 * dropped by subscribers.
 *
 * Returns whether the write landed — `false` on the stale-write bail (the newer write's own
 * normalize run owns the field, listeners included) or an empty write result.
 */
async function writeBack(
  event: EntityFieldChangeEvent,
  original: AddressStructLike,
  merged: AddressStructLike
): Promise<boolean> {
  const ctx = createFieldValueContext(event.organizationId, event.userId, undefined, undefined, {
    skipPreHooks: true,
  })

  // Stale-write guard: the geocode ran fire-and-forget, so the user (or another writer) may have
  // changed the field while it was in flight. Re-read and bail unless the stored components still
  // match the value this normalize started from — the newer write's own hook run owns the field.
  const current = extractStruct(
    await getValue(ctx, { recordId: event.recordId, fieldId: event.field.id }, event.field)
  )
  if (!current || componentHash(current) !== componentHash(original)) return false

  const result = await setValueWithBuiltIn(ctx, {
    recordId: event.recordId,
    fieldId: event.field.id,
    value: merged,
    publishEvents: false,
  })

  if (result.values.length === 0) return false

  const { entityInstanceId } = parseRecordId(event.recordId)
  const publishRecordId = event.field.entityDefinitionId
    ? toRecordId(event.field.entityDefinitionId, entityInstanceId)
    : event.recordId

  const entry = buildPublishEntry({
    publishRecordId,
    fieldId: event.field.id as FieldId,
    field: event.field,
    values: result.values,
  })

  publishFieldValueUpdates(getRealtimeService(), event.organizationId, [entry]).catch((error) => {
    logger.warn('Address normalize realtime publish failed', {
      recordId: event.recordId,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  return true
}
