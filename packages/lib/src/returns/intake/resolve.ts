// packages/lib/src/returns/intake/resolve.ts

/**
 * Step 2 (plans/money/tasks/57 §4): the tier ladder, and the customer candidates.
 *
 * Deterministic and LLM-free by construction, for `purchasing/intake/resolve.ts`'s
 * reason with one word swapped: the ladder and its stopping rule are POLICY, and
 * policy expressed in a prompt varies per run — which is exactly what the
 * customer on a return may not do. The model's job upstream is to read the
 * label; deciding which of our customers a printed sender block means is this
 * file's.
 *
 * ## Batched, on purpose
 *
 * Twenty labels against four tiers is up to eighty round trips if each label
 * resolves itself. This file issues **three statements total, whatever the label
 * count**: one for the address tiers, one for the name tiers, one to label the
 * contacts the address tiers named. The per-label work is a map lookup.
 *
 * ## 🛑 The address tiers are dark today, and that is expected
 *
 * ✅ Measured against the dev database on 2026-09-13: `order_shipping_address`
 * holds **0 values** on all 28 orgs against 13,527 orders, and not one
 * connector-written ADDRESS_STRUCT value exists anywhere in the product (the 109
 * that do exist are all hand-written `company_headquarters`). The cause is the
 * `extractValue` defect in `packages/utils/src/calc-expression.ts` (brief §0.4),
 * whose fix plus a re-sync are both still owed.
 *
 * So tiers 1 and 2 return nothing and the ladder **degrades silently to
 * `name_place`**. It does not refuse, it does not warn, and it does not branch —
 * the statement runs, matches no rows, and the name tiers answer. It lights up
 * on its own the day the values arrive.
 *
 * ## 🛑 Nothing auto-links
 *
 * There is deliberately no `isAutoLinkTier` in this module (`client.ts` records
 * why). Every tier produces candidates a human confirms. The tier is a RANKING
 * and a BADGE; it must never become a branch in a writer.
 *
 * No permission checks. The router asserts and calls in.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { isLiveFulfillment } from '../../sales/fulfillments/client'
import { readFulfillmentsForOrders } from '../../sales/fulfillments/reads'
import type {
  ReturnIntakeCandidate,
  ReturnIntakeOrderOption,
  ReturnIntakeTier,
  TranscribedLabel,
} from './client'
import { RETURN_INTAKE_TIER_RANK } from './client'
import { guard } from './guard'

const logger = createScopedLogger('returns:intake:resolve')

/** How many customers one label offers before the picker stops helping. */
const CANDIDATE_LIMIT = 8

/**
 * How many contacts the name tiers will read in one statement.
 *
 * ⚠️ A truncating cap, and it is deliberate: one common surname across twenty
 * labels can name thousands of contacts, and a picker seeded with four hundred
 * Smiths is the same as no picker. The cap bounds the read, then
 * {@link CANDIDATE_LIMIT} bounds what any one label shows.
 */
const NAME_ROW_LIMIT = 500

/**
 * `order_fulfillment_status` values that mean something physically left.
 *
 * ⚠️ Used ONLY by {@link readOrderOptionsForContact}'s documented fallback, for
 * orders that carry no `fulfillment` record at all. See its docblock.
 */
const SHIPPED_ORDER_STATUSES = ['fulfilled', 'partial'] as const

/**
 * The trimmed, case-folded form both a printed line and a stored value take.
 *
 * ⚠️ `normalizeForLookup` and nothing else (§4.2). `@auxx/utils`'s `format*`
 * helpers are dead code that strips hyphens and apostrophes — they would turn
 * `O'Brien` into `OBrien` and `Stratford-on-Avon` into one word.
 */
function foldKey(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = normalizeForLookup('TEXT', value)
  if (typeof normalized !== 'string' || !normalized) return null
  return normalized.toLowerCase()
}

/** Word tokens of a folded name, for the order-insensitive name match. */
function nameTokens(value: string | null | undefined): string[] {
  const folded = foldKey(value)
  if (!folded) return []
  return folded.split(/[\s,]+/).filter((token) => token.length > 0)
}

/** `street1|postalCode` — tier 1's key. Null unless BOTH halves are printed. */
function addressZipKey(label: TranscribedLabel): string | null {
  const street = foldKey(label.senderStreet1)
  const zip = foldKey(label.senderPostalCode)
  return street && zip ? `${street}|${zip}` : null
}

/**
 * `street1|city|region` — tier 2's key, for a ZIP that was missing or misread.
 *
 * The region half is `coalesce(…, '')` on both sides, so a label with no region
 * matches an order with no region rather than matching nothing at all.
 */
function addressCityKey(label: TranscribedLabel): string | null {
  const street = foldKey(label.senderStreet1)
  const city = foldKey(label.senderCity)
  if (!street || !city) return null
  return `${street}|${city}|${foldKey(label.senderRegion) ?? ''}`
}

/** Every place word the label printed, for tier 3's narrowing. */
function placeKeys(label: TranscribedLabel): {
  city: string | null
  region: string | null
  country: string | null
} {
  return {
    city: foldKey(label.senderCity),
    region: foldKey(label.senderRegion),
    country: foldKey(label.senderCountry),
  }
}

/** What the name statement answers with, per contact. */
interface ContactRow {
  contactId: string
  firstName: string | null
  lastName: string | null
  city: string | null
  region: string | null
  country: string | null
}

/** What the address statement answers with, per order that matched. */
interface AddressRow {
  orderId: string
  contactId: string | null
  orderNumber: string | null
  zipKey: string | null
  cityKey: string | null
}

function displayName(first: string | null, last: string | null): string {
  const name = [first, last]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
  return name || 'Unnamed contact'
}

function displayPlace(city: string | null, region: string | null): string | null {
  const place = [city, region]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ')
  return place || null
}

/**
 * Tiers 1 and 2, in ONE statement over the whole label array.
 *
 * 🔑 They share a statement because they share a row set: both read the same
 * `order_shipping_address` values and differ only in which computed key they
 * compare. Running them separately would scan the same rows twice to answer the
 * same question.
 *
 * 🛑 `order.shippingAddress` is `filterable: false` and an ADDRESS_STRUCT stored
 * in `FieldValue.valueJson`, so the keys are computed expressions and cannot be
 * indexed. **The scope is the `(organizationId, fieldId)` index**, which bounds
 * the scan to one row per order — measured at 13,527 rows and ~14 ms on the
 * largest dev org. Narrowing further by "the order shipped" was measured and
 * REJECTED: `order_fulfillment_status` is `fulfilled`/`partial` on 13,189 of
 * 13,527 orders, so the extra join removes 2.5% of rows and costs 7.7× the time
 * (109 ms vs 14 ms). Brief §4.2 left "index or scope" open; the measurement says
 * neither is needed, and a generated column on the shared hot `FieldValue` table
 * is certainly not.
 */
async function matchByAddress(
  db: Database,
  organizationId: string,
  orderDefId: string | null | undefined,
  zipKeys: string[],
  cityKeys: string[]
): Promise<AddressRow[]> {
  if ((zipKeys.length === 0 && cityKeys.length === 0) || !orderDefId) return []

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['order_shipping_address', 'order_contact', 'order_number'] as const)

  const addressField = fields.order_shipping_address
  if (!addressField) return []

  const addressValue = alias(schema.FieldValue, 'order_address_value')
  const contactValue = alias(schema.FieldValue, 'order_contact_value')
  const numberValue = alias(schema.FieldValue, 'order_number_value')

  const street = sql`lower(btrim(${addressValue.valueJson} ->> 'street1'))`
  const zipExpr = sql<string>`${street} || '|' || lower(btrim(${addressValue.valueJson} ->> 'zipCode'))`
  const cityExpr = sql<string>`${street} || '|' || lower(btrim(${addressValue.valueJson} ->> 'city')) || '|' || coalesce(lower(btrim(${addressValue.valueJson} ->> 'state')), '')`

  const keyMatches: SQL[] = []
  if (zipKeys.length > 0) keyMatches.push(inArray(zipExpr, zipKeys))
  if (cityKeys.length > 0) keyMatches.push(inArray(cityExpr, cityKeys))

  return db
    .select({
      orderId: addressValue.entityId,
      contactId: contactValue.relatedEntityId,
      orderNumber: numberValue.valueText,
      zipKey: zipExpr,
      cityKey: cityExpr,
    })
    .from(addressValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, addressValue.entityId),
        eq(schema.EntityInstance.entityDefinitionId, orderDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .leftJoin(
      contactValue,
      and(
        eq(contactValue.entityId, addressValue.entityId),
        eq(contactValue.organizationId, addressValue.organizationId),
        eq(contactValue.fieldId, fields.order_contact?.id ?? '')
      )
    )
    .leftJoin(
      numberValue,
      and(
        eq(numberValue.entityId, addressValue.entityId),
        eq(numberValue.organizationId, addressValue.organizationId),
        eq(numberValue.fieldId, fields.order_number?.id ?? '')
      )
    )
    .where(
      and(
        eq(addressValue.organizationId, organizationId),
        eq(addressValue.fieldId, addressField.id),
        or(...keyMatches)
      )
    )
}

/**
 * Tiers 3 and 4, in ONE statement over the whole label array.
 *
 * Driven off `lower(last_name)`, which is exactly what
 * `FieldValue_lookup_lower_text_idx (organizationId, fieldId, lower(valueText))`
 * indexes — the same expression `lookup-entities-by-field-value.ts` compares on,
 * so "exact" here means exact modulo case, the answer the rest of the platform
 * gives.
 *
 * ⚠️ Every token of the printed sender name is offered as a possible surname,
 * because a label prints `JOHN SMITH` and `SMITH, JOHN` with equal enthusiasm
 * and nothing on it says which half is which. The over-fetch is bounded by
 * {@link NAME_ROW_LIMIT} and narrowed per label in memory.
 */
async function matchByName(
  db: Database,
  organizationId: string,
  contactDefId: string | null | undefined,
  tokens: string[]
): Promise<ContactRow[]> {
  if (tokens.length === 0 || !contactDefId) return []

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['first_name', 'last_name', 'city', 'region', 'country'] as const)

  const lastField = fields.last_name
  if (!lastField) return []

  const lastValue = alias(schema.FieldValue, 'contact_last_value')
  const firstValue = alias(schema.FieldValue, 'contact_first_value')
  const cityValue = alias(schema.FieldValue, 'contact_city_value')
  const regionValue = alias(schema.FieldValue, 'contact_region_value')
  const countryValue = alias(schema.FieldValue, 'contact_country_value')

  return db
    .select({
      contactId: schema.EntityInstance.id,
      firstName: firstValue.valueText,
      lastName: lastValue.valueText,
      city: cityValue.valueText,
      region: regionValue.valueText,
      country: countryValue.valueText,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      lastValue,
      and(
        eq(lastValue.entityId, schema.EntityInstance.id),
        eq(lastValue.organizationId, schema.EntityInstance.organizationId),
        eq(lastValue.fieldId, lastField.id),
        inArray(sql`lower(${lastValue.valueText})`, tokens)
      )
    )
    .leftJoin(
      firstValue,
      and(
        eq(firstValue.entityId, schema.EntityInstance.id),
        eq(firstValue.organizationId, schema.EntityInstance.organizationId),
        eq(firstValue.fieldId, fields.first_name?.id ?? '')
      )
    )
    .leftJoin(
      cityValue,
      and(
        eq(cityValue.entityId, schema.EntityInstance.id),
        eq(cityValue.organizationId, schema.EntityInstance.organizationId),
        eq(cityValue.fieldId, fields.city?.id ?? '')
      )
    )
    .leftJoin(
      regionValue,
      and(
        eq(regionValue.entityId, schema.EntityInstance.id),
        eq(regionValue.organizationId, schema.EntityInstance.organizationId),
        eq(regionValue.fieldId, fields.region?.id ?? '')
      )
    )
    .leftJoin(
      countryValue,
      and(
        eq(countryValue.entityId, schema.EntityInstance.id),
        eq(countryValue.organizationId, schema.EntityInstance.organizationId),
        eq(countryValue.fieldId, fields.country?.id ?? '')
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, contactDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(NAME_ROW_LIMIT)
}

/** Name and place for every contact the address tiers named, in one statement. */
async function readContactLabels(
  db: Database,
  organizationId: string,
  contactIds: string[]
): Promise<Map<string, { name: string; place: string | null }>> {
  const labels = new Map<string, { name: string; place: string | null }>()
  if (contactIds.length === 0) return labels

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['first_name', 'last_name', 'city', 'region'] as const)

  const byAttribute = new Map<string, 'first' | 'last' | 'city' | 'region'>()
  if (fields.first_name) byAttribute.set(fields.first_name.id, 'first')
  if (fields.last_name) byAttribute.set(fields.last_name.id, 'last')
  if (fields.city) byAttribute.set(fields.city.id, 'city')
  if (fields.region) byAttribute.set(fields.region.id, 'region')
  if (byAttribute.size === 0) return labels

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, contactIds),
        inArray(schema.FieldValue.fieldId, [...byAttribute.keys()])
      )
    )

  const parts = new Map<string, Record<string, string | null>>()
  for (const row of rows) {
    const slot = byAttribute.get(row.fieldId)
    if (!slot) continue
    const entry = parts.get(row.entityId) ?? {}
    entry[slot] = row.valueText
    parts.set(row.entityId, entry)
  }

  for (const [contactId, entry] of parts) {
    labels.set(contactId, {
      name: displayName(entry.first ?? null, entry.last ?? null),
      place: displayPlace(entry.city ?? null, entry.region ?? null),
    })
  }
  return labels
}

/**
 * Run the ladder over a whole batch of transcribed labels.
 *
 * @returns one candidate array per label, in INPUT order, ranked strongest
 * first. 🛑 Every entry is a proposal. Nothing in the returned shape says
 * "link this" and nothing downstream may invent such a reading (§4.4).
 */
export async function resolveLabelCandidates(
  db: Database,
  organizationId: string,
  labels: TranscribedLabel[]
): Promise<Result<ReturnIntakeCandidate[][], Error>> {
  return guard(
    async () => {
      if (labels.length === 0) return []

      const zipKeyByLabel = labels.map(addressZipKey)
      const cityKeyByLabel = labels.map(addressCityKey)
      const tokensByLabel = labels.map((label) => nameTokens(label.senderName))
      const placeByLabel = labels.map(placeKeys)

      const zipKeys = [...new Set(zipKeyByLabel.filter(isKey))]
      const cityKeys = [...new Set(cityKeyByLabel.filter(isKey))]
      const tokens = [...new Set(tokensByLabel.flat())]

      // 🔑 Both definition ids are resolved BEFORE either tier runs, and neither
      // tier owns one: an address hit still needs the `contact` def to name the
      // customer it found, even on a label whose sender name was unreadable.
      const [contactDefId, orderDefId] = await Promise.all([
        getCachedEntityDefId(organizationId, 'contact'),
        getCachedEntityDefId(organizationId, 'order'),
      ])

      const addressRows = await matchByAddress(db, organizationId, orderDefId, zipKeys, cityKeys)
      const contactRows = await matchByName(db, organizationId, contactDefId, tokens)

      const addressContactIds = [...new Set(addressRows.map((row) => row.contactId).filter(isKey))]
      const addressContactLabels = await readContactLabels(db, organizationId, addressContactIds)

      const byZipKey = new Map<string, AddressRow[]>()
      const byCityKey = new Map<string, AddressRow[]>()
      for (const row of addressRows) {
        if (row.zipKey) push(byZipKey, row.zipKey, row)
        if (row.cityKey) push(byCityKey, row.cityKey, row)
      }

      const contactTokenSets = contactRows.map((row) => ({
        row,
        tokens: [...nameTokens(row.firstName), ...nameTokens(row.lastName)],
      }))

      const resolved = labels.map((_label, index) => {
        /** Best tier wins per `(contact, order)` pair; ties keep the first seen. */
        const best = new Map<string, ReturnIntakeCandidate>()

        const offer = (candidate: ReturnIntakeCandidate) => {
          const key = `${candidate.contactRecordId}|${candidate.orderRecordId ?? ''}`
          const existing = best.get(key)
          if (
            existing &&
            RETURN_INTAKE_TIER_RANK[existing.tier] >= RETURN_INTAKE_TIER_RANK[candidate.tier]
          ) {
            return
          }
          best.set(key, candidate)
        }

        const offerAddressRow = (row: AddressRow, tier: ReturnIntakeTier) => {
          // 🛑 The candidate contract requires a contact, so an address hit on
          // an order with no contact is dropped rather than half-offered. On
          // dev that is 8 of 13,527 orders.
          if (!row.contactId || !contactDefId) return
          const label = addressContactLabels.get(row.contactId)
          offer({
            contactRecordId: toRecordId(contactDefId, row.contactId),
            contactName: label?.name ?? 'Unnamed contact',
            contactPlace: label?.place ?? null,
            orderRecordId: orderDefId ? toRecordId(orderDefId, row.orderId) : null,
            orderNumber: row.orderNumber,
            tier,
          })
        }

        const zipKey = zipKeyByLabel[index]
        if (zipKey) for (const row of byZipKey.get(zipKey) ?? []) offerAddressRow(row, 'address')

        const cityKey = cityKeyByLabel[index]
        if (cityKey) {
          for (const row of byCityKey.get(cityKey) ?? []) offerAddressRow(row, 'address_city')
        }

        const labelTokens = new Set(tokensByLabel[index] ?? [])
        if (labelTokens.size > 0 && contactDefId) {
          const place = placeByLabel[index]
          for (const { row, tokens: contactTokens } of contactTokenSets) {
            if (contactTokens.length === 0) continue
            // Order-insensitive containment: `SMITH, JOHN` and `John Smith`
            // answer the same, and a middle name on the label does not lose
            // the match.
            if (!contactTokens.every((token) => labelTokens.has(token))) continue
            offer({
              contactRecordId: toRecordId(contactDefId, row.contactId),
              contactName: displayName(row.firstName, row.lastName),
              contactPlace: displayPlace(row.city, row.region),
              orderRecordId: null,
              orderNumber: null,
              tier: narrowedByPlace(place, row) ? 'name_place' : 'name',
            })
          }
        }

        // A contact the address tiers already named WITH an order does not also
        // need an order-less row: same customer, strictly less information, and
        // §4.5 fills the order picker after confirmation anyway. Two DIFFERENT
        // orders for one contact both survive — choosing between them is exactly
        // the decision the worker is there to make.
        const contactsWithOrder = new Set(
          [...best.values()].filter((c) => c.orderRecordId).map((c) => c.contactRecordId)
        )

        return [...best.values()]
          .filter((c) => c.orderRecordId !== null || !contactsWithOrder.has(c.contactRecordId))
          .sort(
            (a, b) =>
              RETURN_INTAKE_TIER_RANK[b.tier] - RETURN_INTAKE_TIER_RANK[a.tier] ||
              a.contactName.localeCompare(b.contactName)
          )
          .slice(0, CANDIDATE_LIMIT)
      })

      logger.info('Resolved return labels against the customer ladder', {
        organizationId,
        labels: labels.length,
        matched: resolved.filter((candidates) => candidates.length > 0).length,
        addressTierRows: addressRows.length,
      })

      return resolved
    },
    'Failed to resolve return label candidates',
    { organizationId, labels: labels.length }
  )
}

/**
 * Whether the label's printed place agrees with the contact's — tier 3's
 * narrowing.
 *
 * A comparison is only made where BOTH sides carry the value, and at least one
 * comparison must have been made: a label with no city and a contact with no
 * city are not "in the same place", they are two unknowns. Every comparison that
 * IS made must agree, so a matching city with a contradicting country is tier 4.
 */
function narrowedByPlace(
  place: { city: string | null; region: string | null; country: string | null } | undefined,
  row: ContactRow
): boolean {
  if (!place) return false
  const pairs: [string | null, string | null][] = [
    [place.city, foldKey(row.city)],
    [place.region, foldKey(row.region)],
    [place.country, foldKey(row.country)],
  ]
  let compared = 0
  for (const [printed, stored] of pairs) {
    if (!printed || !stored) continue
    if (printed !== stored) return false
    compared += 1
  }
  return compared > 0
}

/**
 * The confirmed contact's orders that could be returned against (§4.5).
 *
 * 🔑 Not a fuzzy auto-link and no violation of "nothing auto-links": the fuzzy
 * step was the contact and a human performed it. The order is a deterministic
 * consequence of a confirmed fact, and the review screen still shows it.
 *
 * ⚠️ **The fallback the brief asked to be recorded if 55 slipped — it slipped.**
 * ✅ Measured 2026-09-13: `fulfillment` and `fulfillment_line` hold **0 rows**
 * database-wide, because 55's step-3 re-sync has not run. "Has a live
 * fulfillment" is therefore false for every order that exists, and this reader
 * would return empty forever. So: an order that carries **no fulfillment record
 * at all** falls back to `order_fulfillment_status ∈ {fulfilled, partial}`, and
 * an order that carries fulfillment records is judged on them alone —
 * {@link isLiveFulfillment}, because a cancelled dispatch did not ship. The
 * fallback therefore retires itself per order as the re-sync lands, with no
 * second code change and no window where both answers apply.
 */
export async function readOrderOptionsForContact(
  db: Database,
  organizationId: string,
  contactRecordId: RecordId
): Promise<Result<ReturnIntakeOrderOption[], Error>> {
  return guard(
    async () => {
      const contactInstanceId = parseRecordId(contactRecordId).entityInstanceId
      if (!contactInstanceId) return []

      const orderDefId = await getCachedEntityDefId(organizationId, 'order')
      if (!orderDefId) return []

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['order_contact', 'order_number', 'order_fulfillment_status'] as const)

      const contactField = fields.order_contact
      if (!contactField) return []

      const contactValue = alias(schema.FieldValue, 'oo_contact_value')
      const numberValue = alias(schema.FieldValue, 'oo_number_value')
      const statusValue = alias(schema.FieldValue, 'oo_status_value')

      const orders = await db
        .select({
          orderId: schema.EntityInstance.id,
          orderNumber: numberValue.valueText,
          fulfillmentStatus: statusValue.optionId,
        })
        .from(schema.EntityInstance)
        .innerJoin(
          contactValue,
          and(
            eq(contactValue.entityId, schema.EntityInstance.id),
            eq(contactValue.organizationId, schema.EntityInstance.organizationId),
            eq(contactValue.fieldId, contactField.id),
            eq(contactValue.relatedEntityId, contactInstanceId)
          )
        )
        .leftJoin(
          numberValue,
          and(
            eq(numberValue.entityId, schema.EntityInstance.id),
            eq(numberValue.organizationId, schema.EntityInstance.organizationId),
            eq(numberValue.fieldId, fields.order_number?.id ?? '')
          )
        )
        .leftJoin(
          statusValue,
          and(
            eq(statusValue.entityId, schema.EntityInstance.id),
            eq(statusValue.organizationId, schema.EntityInstance.organizationId),
            eq(statusValue.fieldId, fields.order_fulfillment_status?.id ?? '')
          )
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, orderDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )

      if (orders.length === 0) return []

      const fulfillmentsByOrder = await readFulfillmentsForOrders(db, {
        organizationId,
        orderIds: orders.map((order) => order.orderId),
      })

      const options: ReturnIntakeOrderOption[] = []
      for (const order of orders) {
        const fulfillments = fulfillmentsByOrder.get(order.orderId) ?? []

        if (fulfillments.length === 0) {
          const status = order.fulfillmentStatus
          if (!status || !(SHIPPED_ORDER_STATUSES as readonly string[]).includes(status)) continue
          options.push({
            orderRecordId: toRecordId(orderDefId, order.orderId),
            orderNumber: order.orderNumber,
            lastFulfilledAt: null,
          })
          continue
        }

        const live = fulfillments.filter(isLiveFulfillment)
        if (live.length === 0) continue
        const lastFulfilledAt = live
          .map((fulfillment) => fulfillment.shippedAt)
          .filter((shippedAt): shippedAt is string => Boolean(shippedAt))
          .sort()
          .at(-1)
        options.push({
          orderRecordId: toRecordId(orderDefId, order.orderId),
          orderNumber: order.orderNumber,
          lastFulfilledAt: lastFulfilledAt ?? null,
        })
      }

      return options.sort((a, b) => {
        if (a.lastFulfilledAt && b.lastFulfilledAt) {
          return b.lastFulfilledAt.localeCompare(a.lastFulfilledAt)
        }
        if (a.lastFulfilledAt) return -1
        if (b.lastFulfilledAt) return 1
        return (b.orderNumber ?? '').localeCompare(a.orderNumber ?? '')
      })
    },
    'Failed to read order options for a contact',
    { organizationId, contactRecordId }
  )
}

/**
 * Whether this photograph is of an OUTBOUND label (§4.7).
 *
 * True when the recipient block names our own business and the sender does not:
 * a worker photographing the wrong side of a box that is going OUT. ⚠️ Cheap,
 * and the single most likely operator error at a dock.
 *
 * 🛑 **A warning, never a refusal.** The review screen says "this looks like an
 * outbound label"; it does not stop anyone. A worker may legitimately be
 * returning something to a vendor on our own paperwork, and this function has no
 * way to tell that apart from the mistake.
 */
export function looksLikeOutboundLabel(
  label: TranscribedLabel,
  orgBusinessName: string | null | undefined
): boolean {
  const business = nameTokens(orgBusinessName)
  if (business.length === 0) return false

  const namesUs = (value: string | null): boolean => {
    const tokens = new Set(nameTokens(value))
    if (tokens.size === 0) return false
    return business.every((token) => tokens.has(token))
  }

  return namesUs(label.recipientNameRaw) && !namesUs(label.senderName)
}

function isKey(value: string | null): value is string {
  return value !== null
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key)
  if (bucket) bucket.push(value)
  else map.set(key, [value])
}
