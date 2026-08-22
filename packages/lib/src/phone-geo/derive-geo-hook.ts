// packages/lib/src/phone-geo/derive-geo-hook.ts
//
// Post-write hook that fills a record's city/region/country/timezone from the numbering-plan
// origin of the phone number just written.
//
// Registered field-type-keyed on PHONE_INTL (`field-hooks/register-hooks.ts`), mirroring the
// ADDRESS_STRUCT normalize hook — so it fires for every phone field on every entity without
// flipping `hasEntityFieldChangeHooks` on for entities that have no phone field. That one
// registration covers every write path: SMS ingest creating a contact, panel edits, CSV import,
// connector sync and Kopilot all funnel through the field-value mutations.
//
// Unlike `normalizeAddressOnChange` this does NOT need to be fire-and-forget: the lookup is an
// in-memory table read (~0.2µs, see `lookup.ts`), not a network call, so the whole handler is
// awaited inline and still costs less than the logging around it.

import { createScopedLogger } from '@auxx/logger'
import { extractValue, type TypedFieldValue } from '@auxx/types'
import type { FieldId } from '@auxx/types/field'
import { getCachedCustomFields } from '../cache/org-cache-helpers'
import type { EntityFieldChangeEvent, EntityFieldChangeHandler } from '../field-hooks/types'
import { createFieldValueContext, getField } from '../field-values/field-value-helpers'
import { buildPublishEntry, setValueWithBuiltIn } from '../field-values/field-value-mutations'
import { getValues } from '../field-values/field-value-queries'
import type { CachedField } from '../field-values/types'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'
import { parseRecordId, toRecordId } from '../resources/resource-id'
import { lookupPhoneGeo } from './lookup'
import type { PhoneGeo } from './types'

const logger = createScopedLogger('phone-geo')

/** Target systemAttribute → the {@link PhoneGeo} key that feeds it. */
const GEO_TARGETS = [
  ['city', 'city'],
  ['region', 'region'],
  ['country', 'country'],
  ['timezone', 'timezone'],
] as const satisfies ReadonlyArray<readonly [string, keyof PhoneGeo]>

/**
 * The number to derive from.
 *
 * Contact `phone` is `options: { multi: true }`, so a multi write arrives as an array ordered by
 * `sortKey` — index 0 is the primary, which is also what outbound SMS/voice dials. A cleared
 * field arrives as `null`. Exported for the finalize integrity passes, which re-read the stored
 * value (same `TypedFieldValue`/array shape) and need the exact same unwrapping.
 */
export function extractPrimaryPhone(value: unknown): string | null {
  const typed = value as TypedFieldValue | TypedFieldValue[] | null
  const first = Array.isArray(typed) ? typed[0] : typed
  if (!first) return null
  const extracted = extractValue(first)
  return typeof extracted === 'string' && extracted.trim() ? extracted.trim() : null
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const typed = value as TypedFieldValue | TypedFieldValue[]
  const first = Array.isArray(typed) ? typed[0] : typed
  if (!first) return true
  const extracted = extractValue(first)
  return typeof extracted === 'string' ? extracted.trim().length === 0 : false
}

/**
 * Fill blank geo fields on the record whose phone number just changed.
 *
 * No-ops — never throws — when the number is unparseable, when the entity has no geo fields
 * (the hook fires for PHONE_INTL on any entity, but city/region/country/timezone are contact
 * fields), or when every target already holds a value.
 */
export const derivePhoneGeoOnChange: EntityFieldChangeHandler = async (event) => {
  const phone = extractPrimaryPhone(event.newValue)
  if (!phone) return

  const geo = lookupPhoneGeo(phone)
  if (!geo) return

  try {
    await fillBlankGeoFields(event, geo)
  } catch (error) {
    logger.error('Phone geo derivation failed', {
      recordId: event.recordId,
      fieldId: event.field.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The derivation core: resolve the entity's geo target fields, fill only the BLANK ones from
 * `geo`, write quietly (`publishEvents: false`), and publish one hand-rolled realtime frame.
 * The inline hook wraps this in its own try/catch; the finalize integrity passes
 * (`events/handlers/finalize-integrity-passes.ts`) call it directly with a synthesized event —
 * only `organizationId`, `entityDefinitionId`, `userId`, `recordId`, and
 * `field.entityDefinitionId` are read. Fill-only-if-blank makes it idempotent by construction.
 */
export async function fillBlankGeoFields(
  event: EntityFieldChangeEvent,
  geo: PhoneGeo
): Promise<void> {
  // Resolve targets within THIS entity definition rather than through `resolveFieldIds`, whose
  // systemAttribute map is global across every definition in the org and would happily hand back
  // another entity's `city` field.
  const fields = await getCachedCustomFields(event.organizationId, event.entityDefinitionId)
  const byAttribute = new Map(
    fields.filter((f) => f.systemAttribute).map((f) => [f.systemAttribute as string, f])
  )

  const candidates = GEO_TARGETS.flatMap(([attribute, geoKey]) => {
    const derived = geo[geoKey]
    const field = byAttribute.get(attribute)
    if (!derived || !field) return []
    return [{ fieldId: field.id, value: derived }]
  })
  if (candidates.length === 0) return

  const ctx = createFieldValueContext(event.organizationId, event.userId, undefined, undefined, {
    skipPreHooks: true,
  })

  // Fill-only-if-blank. These same four fields are written by the chat widget's visitor-IP
  // lookup (`chat/visit-fields.ts`) and by users typing into the panel; both are better signals
  // than an area code, so a phone-derived value may only ever fill a vacuum.
  const existing = await getValues(ctx, {
    recordId: event.recordId,
    fieldIds: candidates.map((c) => c.fieldId),
  })
  const writes = candidates.filter((c) => isBlank(existing.get(c.fieldId)))
  if (writes.length === 0) return

  // Publish against the field's own definition id, matching the address hook. Subscribers key on
  // the cuid-form recordId, and an alias-form id here would publish to a channel nobody is
  // listening on.
  const { entityInstanceId } = parseRecordId(event.recordId)
  const publishRecordId = event.field.entityDefinitionId
    ? toRecordId(event.field.entityDefinitionId, entityInstanceId)
    : event.recordId
  const entries = []

  for (const write of writes) {
    // Quiet write: `publishEvents: false` skips the post-hook chain, field triggers, the timeline
    // entry and the inline realtime publish. Recursion is structurally impossible anyway (this
    // hook keys on PHONE_INTL and only ever writes TEXT fields), but a derivation is not a user
    // edit and should not read as one in the activity feed.
    const result = await setValueWithBuiltIn(ctx, {
      recordId: event.recordId,
      fieldId: write.fieldId,
      value: write.value,
      publishEvents: false,
    })
    if (result.values.length === 0) continue

    let field: CachedField | undefined
    try {
      field = await getField(ctx, write.fieldId)
    } catch {
      field = undefined
    }
    entries.push(
      buildPublishEntry({
        publishRecordId,
        fieldId: write.fieldId as FieldId,
        field,
        values: result.values,
      })
    )
  }

  if (entries.length === 0) return

  // Publish ourselves, since the quiet writes above skipped it — an open contact drawer should
  // show the derived location without a reload.
  publishFieldValueUpdates(getRealtimeService(), event.organizationId, entries).catch((error) => {
    logger.warn('Phone geo realtime publish failed', {
      recordId: event.recordId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
