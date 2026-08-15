// packages/lib/src/dedup/corroborate.ts
//
// Corroborating evidence, and the assembly of the Phase-2 signal set for one
// pair. READS ONLY, ZERO permission checks (lib-module-guide §6) — same system
// posture as `blocking.ts` and `blocking-fuzzy.ts`.
//
// A corroborating signal NEVER suggests on its own, whatever the arithmetic
// would say: `scorePair` gates the whole corroborating block on at least one
// strong or fuzzy signal being present. What corroboration does is promote a
// name match whose surname is too common to stand alone — `Bob Smith` /
// `Robert Smith` reaches `medium` this way and only this way.
//
// Five corroborators, cheapest first:
//
//  1. **Same employer** — equal `relatedEntityId` on a shared RELATIONSHIP
//     field, served by `FieldValue_lookup_related_idx`.
//  2. **Same address** — equal normalized `valueText` on an ADDRESS field.
//  3. **Complementary identities** — `RecordIdentity` rows from different
//     `source`s, i.e. two systems each know one of the two records.
//  4. **Email domain ↔ employer domain** — one record's email domain is the
//     other's employer's `company_domain`. Domain extraction is reused from
//     `ingest/domain/classifier.ts` (`classifyForCompany`, the same function
//     `linkContactToCompanyByDomain` uses), never re-implemented: it already
//     handles eTLD+1, free-provider domains, excluded TLDs and the org's own
//     domains.
//  5. **Same ingest event** — both records' `firstInteractionAt` on the same
//     SECOND. ⚠️ Measured on dev: the busiest second is shared by 11 records,
//     because one thread's participants genuinely do share a first-message
//     time. That IS the signal (one ingest event created them), but it means
//     this arm is the loosest of the five — which is why it is corroborating and
//     can never move a pair on its own.

import { type Database, schema } from '@auxx/database'
import type { FieldId } from '@auxx/types/field'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { type StoredFieldType, toFieldType } from '../field-values/stored-field-type'
import { classifyForCompany, normalizeDomain } from '../ingest/domain/classifier'
import type { ResourceField } from '../resources/registry/field-types'
import { compareStructuredNames, decideNameSignal, type StructuredName } from './name-match'
import { type SurnameRarity, surnameIdf } from './surname-rarity'
import type { Signal } from './types'

/** The fields corroboration reads, resolved once per definition. */
export interface CorroborationFields {
  /** RELATIONSHIP fields — employer, company, and any other record link. */
  relationshipFieldIds: FieldId[]
  /** ADDRESS fields, compared on normalized `valueText`. */
  addressFieldIds: FieldId[]
  /** EMAIL fields, used for the domain ↔ employer-domain arm. */
  emailFieldIds: FieldId[]
}

/**
 * Split a definition's fields into the three groups corroboration uses.
 *
 * Reads nothing — the caller passes what it already has from
 * `getCachedResourceFields`, so a scan of N records costs one cache read.
 *
 * `fieldType` is folded through `toFieldType` for the same reason
 * `deriveMatchKeys` does it: the pg enum still carries the legacy `PHONE`
 * spelling, and folding once here keeps every comparison on `FieldType`.
 */
export function deriveCorroborationFields(fields: ResourceField[]): CorroborationFields {
  const relationshipFieldIds: FieldId[] = []
  const addressFieldIds: FieldId[] = []
  const emailFieldIds: FieldId[] = []

  for (const field of fields) {
    if (field.active === false) continue
    if (!field.fieldType) continue
    const fieldType = toFieldType(field.fieldType as StoredFieldType)
    if (fieldType === 'RELATIONSHIP') relationshipFieldIds.push(field.id)
    else if (fieldType === 'ADDRESS') addressFieldIds.push(field.id)
    else if (fieldType === 'EMAIL') emailFieldIds.push(field.id)
  }

  return { relationshipFieldIds, addressFieldIds, emailFieldIds }
}

/**
 * Fold an address for equality: lowercase, punctuation to a single space,
 * trimmed. `"12 Main St."` and `"12 main st"` are one address.
 *
 * Deliberately not a postal normalizer — no abbreviation expansion, no locale
 * rules. This is a corroborator worth 0.2; it needs to be cheap and it needs to
 * never claim a match it cannot justify.
 */
export function normalizeAddressValue(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** One side's raw field values, as gathered for the pair. */
interface SideValues {
  related: Map<string, Set<string>>
  addresses: Map<string, Set<string>>
  emails: Set<string>
}

const emptySide = (): SideValues => ({
  related: new Map(),
  addresses: new Map(),
  emails: new Set(),
})

/** Parameters for {@link corroboratePair}. */
export interface CorroboratePairParams {
  organizationId: string
  instanceIdLow: string
  instanceIdHigh: string
  fields: CorroborationFields
  /**
   * The org's own email domains, when the caller already resolved them.
   *
   * Passed through to `classifyForCompany` so a per-pair call does not hit the
   * org cache; omitted, the classifier reads `orgProfile` itself.
   */
  ownDomains?: Set<string>
}

/** Values held by both sides of one field, as a `Map` intersection helper. */
function sharedValues(
  low: Map<string, Set<string>>,
  high: Map<string, Set<string>>
): Array<{ fieldId: string; value: string }> {
  const shared: Array<{ fieldId: string; value: string }> = []
  for (const [fieldId, lowValues] of low) {
    const highValues = high.get(fieldId)
    if (!highValues) continue
    for (const value of lowValues) if (highValues.has(value)) shared.push({ fieldId, value })
  }
  return shared
}

/**
 * Every corroborating signal two records share.
 *
 * Returns signals already oriented onto the canonical low/high axis — the
 * caller passes `instanceIdLow` and `instanceIdHigh` explicitly, so nothing
 * downstream needs to re-orient them.
 *
 * @returns possibly empty; never an error for missing data, only for a failed query.
 */
export async function corroboratePair(
  db: Database,
  params: CorroboratePairParams
): Promise<Result<Signal[], Error>> {
  const { organizationId, instanceIdLow, instanceIdHigh, fields } = params
  const instanceIds = [instanceIdLow, instanceIdHigh]
  const signals: Signal[] = []

  const fieldIds = [
    ...fields.relationshipFieldIds,
    ...fields.addressFieldIds,
    ...fields.emailFieldIds,
  ].map((id) => id as string)

  const relationshipIds = new Set(fields.relationshipFieldIds.map((id) => id as string))
  const addressIds = new Set(fields.addressFieldIds.map((id) => id as string))
  const emailIds = new Set(fields.emailFieldIds.map((id) => id as string))

  const sides = new Map<string, SideValues>([
    [instanceIdLow, emptySide()],
    [instanceIdHigh, emptySide()],
  ])

  if (fieldIds.length > 0) {
    const rows = await db
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        valueText: schema.FieldValue.valueText,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, instanceIds),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      )

    for (const row of rows) {
      const side = sides.get(row.entityId)
      if (!side) continue
      if (relationshipIds.has(row.fieldId) && row.relatedEntityId) {
        const bucket = side.related.get(row.fieldId) ?? new Set<string>()
        bucket.add(row.relatedEntityId)
        side.related.set(row.fieldId, bucket)
      } else if (addressIds.has(row.fieldId)) {
        const value = normalizeAddressValue(row.valueText)
        if (!value) continue
        const bucket = side.addresses.get(row.fieldId) ?? new Set<string>()
        bucket.add(value)
        side.addresses.set(row.fieldId, bucket)
      } else if (emailIds.has(row.fieldId) && row.valueText) {
        side.emails.add(row.valueText.trim().toLowerCase())
      }
    }
  }

  const low = sides.get(instanceIdLow) as SideValues
  const high = sides.get(instanceIdHigh) as SideValues

  // ── 1. Same employer / same linked record ─────────────────────────────────
  const sharedRelated = sharedValues(low.related, high.related)
  if (sharedRelated.length > 0) {
    // Name the shared record, not its id: "matched on: company" cannot tell a
    // reviewer WHICH company without it.
    const relatedIds = [...new Set(sharedRelated.map((s) => s.value))]
    const relatedRows = await db
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, relatedIds))
    const nameById = new Map(relatedRows.map((row) => [row.id, row.displayName]))

    for (const shared of sharedRelated) {
      signals.push({
        type: 'company',
        strength: 'corroborating',
        value: nameById.get(shared.value) ?? shared.value,
      })
    }
  }

  // ── 2. Same address ───────────────────────────────────────────────────────
  for (const shared of sharedValues(low.addresses, high.addresses)) {
    signals.push({ type: 'address', strength: 'corroborating', value: shared.value })
  }

  // ── 3. Complementary identity sources ─────────────────────────────────────
  const identityRows = await db
    .select({
      entityInstanceId: schema.RecordIdentity.entityInstanceId,
      source: schema.RecordIdentity.source,
    })
    .from(schema.RecordIdentity)
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        inArray(schema.RecordIdentity.entityInstanceId, instanceIds)
      )
    )

  const lowSources = new Set(
    identityRows.filter((r) => r.entityInstanceId === instanceIdLow).map((r) => r.source)
  )
  const highSources = new Set(
    identityRows.filter((r) => r.entityInstanceId === instanceIdHigh).map((r) => r.source)
  )
  // Complementarity, not overlap: two systems each holding ONE of the pair is
  // evidence that one customer got split across integrations. (A shared
  // externalId under two connections is a different, STRONG fact and is
  // `blockIdentity`'s job, not this one.)
  const complementary =
    lowSources.size > 0 &&
    highSources.size > 0 &&
    ([...lowSources].some((s) => !highSources.has(s)) ||
      [...highSources].some((s) => !lowSources.has(s)))
  if (complementary) {
    signals.push({
      type: 'identity',
      strength: 'corroborating',
      value: [...lowSources].sort().join(','),
      otherValue: [...highSources].sort().join(','),
    })
  }

  // ── 4. Email domain ↔ employer domain ─────────────────────────────────────
  const employerDomains = await readEmployerDomains(db, organizationId, [
    ...new Set([...low.related.values(), ...high.related.values()].flatMap((set) => [...set])),
  ])
  const lowEmployerDomains = domainsFor(low, employerDomains)
  const highEmployerDomains = domainsFor(high, employerDomains)

  const crossDomain =
    (await matchEmailDomain(params, low.emails, highEmployerDomains)) ??
    (await matchEmailDomain(params, high.emails, lowEmployerDomains))
  if (crossDomain) {
    signals.push({ type: 'company', strength: 'corroborating', value: crossDomain })
  }

  // ── 5. Same ingest event ──────────────────────────────────────────────────
  const interactionRows = await db
    .select({
      id: schema.EntityInstance.id,
      firstInteractionAt: schema.EntityInstance.firstInteractionAt,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, instanceIds),
        isNotNull(schema.EntityInstance.firstInteractionAt)
      )
    )
  if (interactionRows.length === 2) {
    const [a, b] = interactionRows as [
      (typeof interactionRows)[number],
      (typeof interactionRows)[number],
    ]
    const secondA = Math.floor((a.firstInteractionAt as Date).getTime() / 1000)
    const secondB = Math.floor((b.firstInteractionAt as Date).getTime() / 1000)
    if (secondA === secondB) {
      signals.push({
        type: 'ingest',
        strength: 'corroborating',
        value: new Date(secondA * 1000).toISOString(),
      })
    }
  }

  return ok(signals)
}

/** `companyInstanceId → normalized company_domain`, for the linked records of a pair. */
async function readEmployerDomains(
  db: Database,
  organizationId: string,
  relatedIds: string[]
): Promise<Map<string, string>> {
  if (relatedIds.length === 0) return new Map()

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.CustomField,
      and(
        eq(schema.CustomField.id, schema.FieldValue.fieldId),
        eq(schema.CustomField.systemAttribute, 'company_domain')
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, relatedIds),
        isNotNull(schema.FieldValue.valueText)
      )
    )

  const byId = new Map<string, string>()
  for (const row of rows) {
    if (!row.valueText) continue
    byId.set(row.entityId, normalizeDomain(row.valueText))
  }
  return byId
}

/** The employer domains one side of the pair links to. */
function domainsFor(side: SideValues, employerDomains: Map<string, string>): Set<string> {
  const domains = new Set<string>()
  for (const related of side.related.values()) {
    for (const id of related) {
      const domain = employerDomains.get(id)
      if (domain) domains.add(domain)
    }
  }
  return domains
}

/** First email whose registrable domain is one of the other side's employer domains. */
async function matchEmailDomain(
  params: CorroboratePairParams,
  emails: Set<string>,
  otherEmployerDomains: Set<string>
): Promise<string | null> {
  if (emails.size === 0 || otherEmployerDomains.size === 0) return null
  for (const email of emails) {
    // `classifyForCompany` already drops free-provider domains, excluded TLDs
    // and the org's own domains — the exact filtering that makes an email domain
    // mean "employer" rather than "has a gmail account".
    const domain = await classifyForCompany(params.organizationId, email, params.ownDomains)
    if (domain && otherEmployerDomains.has(normalizeDomain(domain))) return normalizeDomain(domain)
  }
  return null
}

/** Parameters for {@link evaluateFuzzyPair}. */
export interface EvaluateFuzzyPairParams extends CorroboratePairParams {
  entityDefinitionId: string
  /** Structured name of the LOW record. */
  nameLow: StructuredName
  /** Structured name of the HIGH record. */
  nameHigh: StructuredName
  /** `CustomField.id` of the surname field, so rarity skips its own lookup. */
  surnameFieldId?: FieldId
  /**
   * Pre-resolved rarity for the matched surname.
   *
   * A scan scores one record against several neighbours that mostly share its
   * surname, so the caller should resolve rarity ONCE per scanned record and
   * pass it here rather than paying the aggregate per pair.
   */
  surnameRarity?: SurnameRarity
}

/**
 * The complete Phase-2 signal set for one candidate pair, or an empty list.
 *
 * The composition the scan job runs per fuzzy candidate:
 *
 * ```text
 * blockFuzzyRecord → readStructuredNames → evaluateFuzzyPair → scorePair → upsertPairs
 * ```
 *
 * Order matters and is not incidental:
 *
 *  1. **Compare names first, and bail if they do not match.** Corroboration
 *     alone can never suggest, so running its five queries for a pair with no
 *     name match would be pure cost.
 *  2. **Corroborate, then decide.** `decideNameSignal` needs to know whether any
 *     corroborating signal exists before it can apply the name-alone rule.
 *  3. **Return nothing when the name signal is withheld.** A pair carrying only
 *     corroborating signals is one `scorePair` would gate to zero anyway, and
 *     storing it would put evidence on a row nobody will ever see.
 *
 * @returns `[name, ...corroborators]`, or `[]` when the pair does not qualify.
 */
export async function evaluateFuzzyPair(
  db: Database,
  params: EvaluateFuzzyPairParams
): Promise<Result<Signal[], Error>> {
  const comparison = compareStructuredNames(params.nameLow, params.nameHigh)
  if (!comparison.matched || !comparison.surname) return ok([])

  const corroborated = await corroboratePair(db, params)
  if (corroborated.isErr()) return corroborated

  let rarity = params.surnameRarity
  if (!rarity) {
    const computed = await surnameIdf(
      db,
      params.organizationId,
      params.entityDefinitionId,
      comparison.surname.value,
      { surnameFieldId: params.surnameFieldId }
    )
    // Re-wrapped, not returned: `err<T, E>` takes the OK type FIRST.
    if (computed.isErr()) return err<Signal[], Error>(computed.error)
    rarity = computed.value
  }

  const outcome = decideNameSignal({
    comparison,
    surnameRare: rarity.rare,
    hasCorroboration: corroborated.value.length > 0,
  })
  if (!outcome.signal) return ok([])

  return ok([outcome.signal, ...corroborated.value])
}
