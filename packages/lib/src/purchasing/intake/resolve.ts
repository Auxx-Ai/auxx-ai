// packages/lib/src/purchasing/intake/resolve.ts

/**
 * Step 2 (plans/money/tasks/38 §5): the tier ladder, and the vendor candidates.
 *
 * Deterministic and LLM-free by construction. The ladder and its stopping rule
 * are POLICY, and policy expressed in a prompt varies per run — which is exactly
 * what a purchase order line may not do. The model's job upstream is to read the
 * document; deciding which of our parts a printed code means is this file's.
 *
 * ## Batched, on purpose
 *
 * Forty lines against three tiers is up to 120 round trips if each line resolves
 * itself. Every tier here is ONE statement over the whole line array, and the
 * per-line work is a map lookup. The only per-line read left is
 * {@link findVendorPartForLine}, memoized by part, and only for lines that
 * actually auto-linked.
 *
 * ## Tier order is the order the DATA supports
 *
 * `vendor_sku` is the strongest match and `sku` the second, but 4 of 206
 * `vendor_part` rows in the main org carry a `vendorSku` while all 257 parts
 * carry a `sku` (§0). So `sku` is what actually fires today, and the commit's
 * write-backs are what eventually make `vendor_sku` real.
 *
 * 🛑 `fuzzy` NEVER auto-links. A normalized title match is a suggestion; linking
 * one puts a part nobody chose onto a line that becomes a real order. That rule
 * lives in `isAutoLinkTier` and this file asks it rather than restating it.
 *
 * No permission checks. The router asserts and calls in.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { findVendorPartForLine } from '../vendor-part-lookup'
import type {
  IntakeCandidate,
  IntakeLine,
  IntakePartCandidate,
  IntakeTier,
  TranscribedLine,
  TranscribedQuote,
} from './client'
import { isAutoLinkTier, parseIntakeUnitPrice } from './client'
import { guard } from './guard'

const logger = createScopedLogger('purchasing:intake:resolve')

/** How many vendor candidates the review screen's picker is seeded with. */
const VENDOR_CANDIDATE_LIMIT = 10

/** How many part candidates one line offers before the list stops helping. */
const PART_CANDIDATE_LIMIT = 5

/** What one line resolution is asked about. */
export interface ResolveQuoteLinesInput {
  /** The `company` the quote came from, once picked. `null` disables tier 1. */
  vendorRecordId: RecordId | null
  /** ISO 4217 the printed money strings are read in. */
  currency: string
  lines: TranscribedLine[]
}

/** The trimmed, case-folded form both the printed code and the stored value take. */
function foldKey(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = normalizeForLookup('TEXT', value)
  if (typeof normalized !== 'string' || !normalized) return null
  return normalized.toLowerCase()
}

/** Postgres `ilike` metacharacters, so a vendor called `100%` searches for itself. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

/**
 * Candidate `company` rows for the quote's vendor block.
 *
 * 🛑 This does not PICK. It returns what the name matched, or — when the name
 * matched nothing — what the email domain matched, and the human chooses on the
 * review screen before anything is written. A wrong vendor is visible at a
 * glance in a way a wrong part on line 27 is not, which is why this is the one
 * value in the pipeline a person settles rather than a ladder.
 *
 * ⚠️ The vendor is a `company`, never a `contact`: `purchase_order_vendor` and
 * `vendor_part_contact` both declare `relatedEntityType: 'company'`. A PO is
 * placed with an organisation.
 */
export async function resolveQuoteVendor(
  db: Database,
  organizationId: string,
  transcription: TranscribedQuote
): Promise<Result<IntakeCandidate[], Error>> {
  return guard(
    async () => {
      const companyDefId = await getCachedEntityDefId(organizationId, 'company')
      if (!companyDefId) return []

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['company_name', 'company_domain'] as const)

      const nameField = fields.company_name
      const domainField = fields.company_domain

      const nameValue = alias(schema.FieldValue, 'company_name_value')

      /** One statement: the matching companies plus the name they matched on. */
      const search = async (where: ReturnType<typeof and>) =>
        db
          .select({ id: schema.EntityInstance.id, name: nameValue.valueText })
          .from(schema.EntityInstance)
          .innerJoin(
            nameValue,
            and(
              eq(nameValue.entityId, schema.EntityInstance.id),
              eq(nameValue.organizationId, schema.EntityInstance.organizationId),
              eq(nameValue.fieldId, nameField?.id ?? '')
            )
          )
          .where(
            and(
              eq(schema.EntityInstance.organizationId, organizationId),
              eq(schema.EntityInstance.entityDefinitionId, companyDefId),
              isNull(schema.EntityInstance.archivedAt),
              where
            )
          )
          .limit(VENDOR_CANDIDATE_LIMIT)

      let rows: { id: string; name: string | null }[] = []

      const printedName = transcription.vendorName?.trim()
      if (nameField && printedName) {
        rows = await search(ilike(nameValue.valueText, `%${escapeLike(printedName)}%`))
      }

      // Only when the name found nothing: a domain hit on a differently-named
      // row is a weaker signal, and offering both at once buries the good one.
      if (rows.length === 0 && nameField && domainField) {
        const domain = transcription.vendorEmail?.split('@')[1]?.trim().toLowerCase()
        if (domain) {
          const domainValue = alias(schema.FieldValue, 'company_domain_value')
          rows = await db
            .select({ id: schema.EntityInstance.id, name: nameValue.valueText })
            .from(schema.EntityInstance)
            .innerJoin(
              domainValue,
              and(
                eq(domainValue.entityId, schema.EntityInstance.id),
                eq(domainValue.organizationId, schema.EntityInstance.organizationId),
                eq(domainValue.fieldId, domainField.id),
                eq(sql`lower(${domainValue.valueText})`, domain)
              )
            )
            .leftJoin(
              nameValue,
              and(
                eq(nameValue.entityId, schema.EntityInstance.id),
                eq(nameValue.organizationId, schema.EntityInstance.organizationId),
                eq(nameValue.fieldId, nameField.id)
              )
            )
            .where(
              and(
                eq(schema.EntityInstance.organizationId, organizationId),
                eq(schema.EntityInstance.entityDefinitionId, companyDefId),
                isNull(schema.EntityInstance.archivedAt)
              )
            )
            .limit(VENDOR_CANDIDATE_LIMIT)
        }
      }

      return rows.map((row) => ({
        recordId: toRecordId(companyDefId, row.id),
        displayName: row.name ?? 'Unnamed company',
        secondary: transcription.vendorEmail,
      }))
    },
    'Failed to resolve a quote vendor',
    { organizationId }
  )
}

/** A part the ladder found, before it is turned into a candidate. */
interface PartHit {
  partInstanceId: string
  /** Set only by tier 1, which read the catalogue row on the way past. */
  vendorPartInstanceId?: string
}

/**
 * Tier 1: `vendor_part` where `supplier = the quote's vendor` AND
 * `vendorSku = the printed code`.
 *
 * Three FieldValue aliases because all three legs matter: the supplier leg and
 * the sku leg are the match, and the part leg is the answer. `lookupByField`
 * cannot express this — it is OR across candidates, first hit wins.
 */
async function resolveVendorSkuTier(
  db: Database,
  organizationId: string,
  vendorInstanceId: string,
  codes: string[]
): Promise<Map<string, PartHit>> {
  const hits = new Map<string, PartHit>()
  if (codes.length === 0) return hits

  const vendorPartDefId = await getCachedEntityDefId(organizationId, 'vendor_part')
  if (!vendorPartDefId) return hits

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'vendor_part_part',
      'vendor_part_contact',
      'vendor_part_vendor_sku',
    ] as const)

  const partField = fields.vendor_part_part
  const supplierField = fields.vendor_part_contact
  const skuField = fields.vendor_part_vendor_sku
  if (!partField || !supplierField || !skuField) return hits

  const partValue = alias(schema.FieldValue, 'vp_part_value')
  const supplierValue = alias(schema.FieldValue, 'vp_supplier_value')
  const skuValue = alias(schema.FieldValue, 'vp_sku_value')

  const rows = await db
    .select({
      vendorPartInstanceId: schema.EntityInstance.id,
      partInstanceId: partValue.relatedEntityId,
      code: sql<string>`lower(${skuValue.valueText})`,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      supplierValue,
      and(
        eq(supplierValue.entityId, schema.EntityInstance.id),
        eq(supplierValue.organizationId, schema.EntityInstance.organizationId),
        eq(supplierValue.fieldId, supplierField.id),
        eq(supplierValue.relatedEntityId, vendorInstanceId)
      )
    )
    .innerJoin(
      skuValue,
      and(
        eq(skuValue.entityId, schema.EntityInstance.id),
        eq(skuValue.organizationId, schema.EntityInstance.organizationId),
        eq(skuValue.fieldId, skuField.id),
        inArray(sql`lower(${skuValue.valueText})`, codes)
      )
    )
    .innerJoin(
      partValue,
      and(
        eq(partValue.entityId, schema.EntityInstance.id),
        eq(partValue.organizationId, schema.EntityInstance.organizationId),
        eq(partValue.fieldId, partField.id)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, vendorPartDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    if (!row.partInstanceId || !row.code) continue
    if (hits.has(row.code)) continue
    hits.set(row.code, {
      partInstanceId: row.partInstanceId,
      vendorPartInstanceId: row.vendorPartInstanceId,
    })
  }
  return hits
}

/**
 * One statement over a text field of `part`, folded to lower case.
 *
 * `lower("valueText")` is an indexed expression on `FieldValue` and is what
 * `lookup-entities-by-field-value.ts` already compares on, so "exact" here means
 * exact modulo case — the same answer the rest of the platform gives.
 */
async function matchPartsByText(
  db: Database,
  organizationId: string,
  partDefId: string,
  fieldId: string,
  keys: string[]
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  if (keys.length === 0) return found

  const textValue = alias(schema.FieldValue, 'part_text_value')
  const rows = await db
    .select({
      partInstanceId: schema.EntityInstance.id,
      key: sql<string>`lower(${textValue.valueText})`,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      textValue,
      and(
        eq(textValue.entityId, schema.EntityInstance.id),
        eq(textValue.organizationId, schema.EntityInstance.organizationId),
        eq(textValue.fieldId, fieldId),
        inArray(sql`lower(${textValue.valueText})`, keys)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    if (!row.key) continue
    const bucket = found.get(row.key)
    if (bucket) bucket.push(row.partInstanceId)
    else found.set(row.key, [row.partInstanceId])
  }
  return found
}

/** Title + sku for every part any tier named, in one statement, for the badges. */
async function readPartLabels(
  db: Database,
  organizationId: string,
  titleFieldId: string | null,
  skuFieldId: string | null,
  partInstanceIds: string[]
): Promise<Map<string, { title: string | null; sku: string | null }>> {
  const labels = new Map<string, { title: string | null; sku: string | null }>()
  if (partInstanceIds.length === 0) return labels

  const fieldIds = [titleFieldId, skuFieldId].filter((id): id is string => Boolean(id))
  if (fieldIds.length === 0) return labels

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
        inArray(schema.FieldValue.entityId, partInstanceIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  for (const row of rows) {
    const entry = labels.get(row.entityId) ?? { title: null, sku: null }
    if (row.fieldId === titleFieldId) entry.title = row.valueText
    if (row.fieldId === skuFieldId) entry.sku = row.valueText
    labels.set(row.entityId, entry)
  }
  return labels
}

/**
 * Run the ladder over a whole quote.
 *
 * The returned lines are a PROPOSAL. `partRecordId` is set only where
 * {@link isAutoLinkTier} allows it; everything else arrives with candidates and
 * no link, for the review screen to settle.
 */
export async function resolveQuoteLines(
  db: Database,
  organizationId: string,
  input: ResolveQuoteLinesInput
): Promise<Result<IntakeLine[], Error>> {
  return guard(
    async () => {
      const { vendorRecordId, currency, lines } = input

      const partDefId = await getCachedEntityDefId(organizationId, 'part')
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['part_sku', 'part_title'] as const)
      const skuFieldId = fields.part_sku?.id ?? null
      const titleFieldId = fields.part_title?.id ?? null

      const codeKeys = [...new Set(lines.map((line) => foldKey(line.vendorCode)).filter(isKey))]
      const titleKeys = [...new Set(lines.map((line) => foldKey(line.description)).filter(isKey))]

      const vendorInstanceId = vendorRecordId
        ? parseRecordId(vendorRecordId).entityInstanceId
        : null

      const vendorSkuHits = vendorInstanceId
        ? await resolveVendorSkuTier(db, organizationId, vendorInstanceId, codeKeys)
        : new Map<string, PartHit>()

      const skuHits =
        partDefId && skuFieldId
          ? await matchPartsByText(db, organizationId, partDefId, skuFieldId, codeKeys)
          : new Map<string, string[]>()

      const titleHits =
        partDefId && titleFieldId
          ? await matchPartsByText(db, organizationId, partDefId, titleFieldId, titleKeys)
          : new Map<string, string[]>()

      const named = new Set<string>()
      for (const hit of vendorSkuHits.values()) named.add(hit.partInstanceId)
      for (const ids of skuHits.values()) for (const id of ids) named.add(id)
      for (const ids of titleHits.values()) for (const id of ids) named.add(id)

      const labels = await readPartLabels(db, organizationId, titleFieldId, skuFieldId, [...named])

      const toCandidate = (partInstanceId: string, tier: IntakeTier): IntakePartCandidate => {
        const label = labels.get(partInstanceId)
        return {
          recordId: toRecordId(partDefId ?? 'part', partInstanceId),
          displayName: label?.title ?? label?.sku ?? 'Untitled part',
          secondary: label?.sku ?? null,
          tier,
        }
      }

      // One `findVendorPartForLine` per PART, not per line: a 40-line quote that
      // orders the same part three times is one read, and the reader is the same
      // one the line builder's price prefill uses.
      const vendorPartByPart = new Map<string, RecordId | null>()
      const vendorPartFor = async (partInstanceId: string): Promise<RecordId | null> => {
        if (!vendorInstanceId) return null
        const cached = vendorPartByPart.get(partInstanceId)
        if (cached !== undefined) return cached
        const prefill = await findVendorPartForLine(db, organizationId, {
          partInstanceId,
          vendorInstanceId,
        })
        const value = prefill.isOk() ? (prefill.value?.vendorPartRecordId ?? null) : null
        vendorPartByPart.set(partInstanceId, value)
        return value
      }

      const resolved: IntakeLine[] = []
      for (const printed of lines) {
        const codeKey = foldKey(printed.vendorCode)
        const titleKey = foldKey(printed.description)

        let tier: IntakeTier = 'none'
        let candidates: IntakePartCandidate[] = []
        let vendorPartRecordId: RecordId | null = null

        const vendorHit = codeKey ? vendorSkuHits.get(codeKey) : undefined
        const skuMatches = codeKey ? (skuHits.get(codeKey) ?? []) : []
        const titleMatches = titleKey ? (titleHits.get(titleKey) ?? []) : []

        if (vendorHit) {
          tier = 'vendor_sku'
          candidates = [toCandidate(vendorHit.partInstanceId, 'vendor_sku')]
          vendorPartRecordId =
            vendorHit.vendorPartInstanceId && partDefId
              ? await vendorPartFor(vendorHit.partInstanceId)
              : null
        } else if (skuMatches.length > 0) {
          tier = 'sku'
          candidates = skuMatches.slice(0, PART_CANDIDATE_LIMIT).map((id) => toCandidate(id, 'sku'))
        } else if (titleMatches.length > 0) {
          tier = 'fuzzy'
          candidates = titleMatches
            .slice(0, PART_CANDIDATE_LIMIT)
            .map((id) => toCandidate(id, 'fuzzy'))
        }

        // 🛑 `isAutoLinkTier` is the only authority on this. A tier-3 candidate
        // is shown and never linked.
        const autoLink = isAutoLinkTier(tier) && candidates.length > 0
        const partRecordId = autoLink ? (candidates[0]?.recordId ?? null) : null

        if (autoLink && !vendorPartRecordId && partRecordId) {
          vendorPartRecordId = await vendorPartFor(parseRecordId(partRecordId).entityInstanceId)
        }

        resolved.push({
          lineId: generateId(),
          printed,
          tier,
          candidates,
          partRecordId,
          vendorPartRecordId,
          description: printed.description,
          // Transcribed, never invented: an unread quantity stays visibly zero
          // rather than becoming a plausible 1 that gets ordered.
          quantity: printed.quantity ?? 0,
          // A RATE, not an amount: a fastener vendor quoting "$15.94 / 1,000"
          // is $0.01594 each, and rounding that to whole cents misstates half
          // the order. `parseIntakeUnitPrice` keeps the rate's fractional
          // minor units; totals use `parseIntakeTotal` instead.
          unitPriceCents: parseIntakeUnitPrice(printed.unitPriceText, currency),
          chosenBreakIndex: null,
          foldedInto: null,
          removed: false,
        })
      }

      logger.info('Resolved quote lines against the part catalogue', {
        organizationId,
        lines: resolved.length,
        linked: resolved.filter((line) => line.partRecordId !== null).length,
      })

      return resolved
    },
    'Failed to resolve quote lines',
    { organizationId, lines: input.lines.length }
  )
}

function isKey(value: string | null): value is string {
  return value !== null
}
