// packages/lib/src/resources/lookup/lookup-entities-by-field-value.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { FieldId } from '@auxx/types/field'
import { createTypedValueInput } from '@auxx/types/field-value'
import { type AnyColumn, and, asc, eq, isNull, type SQL, sql } from 'drizzle-orm'
// `Result` stays on the signature (house style, and it leaves room for a real
// structural failure later) even though every OK path returns `ok`, an
// unresolvable candidate is an empty result, not an error. The one `err` is the
// opt-in ambiguity policy below. See the docblock.
import { err, ok, type Result } from 'neverthrow'
import { getCachedFieldMap } from '../../cache'
import { ConflictError } from '../../errors'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { typedColumnMatch } from '../../field-values/typed-column-match'
import type { OnAmbiguous } from '../../write-policy'
import { type RecordId, toRecordId } from '../resource-id'

const logger = createScopedLogger('lookup-entities-by-field-value')

type CustomFieldEntity = typeof schema.CustomField.$inferSelect

/**
 * More than one distinct record matched, and the caller asked for
 * `onAmbiguous: 'error'`.
 *
 * Carries the count so the caller can name it in a user-facing row error
 * instead of picking an arbitrary record, the CSV importer's whole reason for
 * asking. `matchCount` is bounded by the `limit` the caller passed, so
 * `hasMore` distinguishes "exactly N" from "at least N".
 */
export class AmbiguousLookupError extends ConflictError {
  readonly matchCount: number
  readonly hasMore: boolean

  constructor(matchCount: number, hasMore = false) {
    super(`Matches ${matchCount}${hasMore ? ' or more' : ''} existing records`)
    this.matchCount = matchCount
    this.hasMore = hasMore
  }
}

/**
 * Candidate for a field-value lookup — one field reference + value to try. Two
 * shapes, resolved through the same `customFields` org-cache:
 *  - `{ systemAttribute }` → matched by `CustomField.systemAttribute` (system
 *    fields / legacy callers: extension, `record.lookupByField`, `findByField`).
 *  - `{ fieldId }` → matched by `CustomField.id` directly — the only path that
 *    resolves connector-provisioned custom fields, whose `systemAttribute` is null.
 */
export type LookupCandidate =
  | { systemAttribute: string; value: unknown }
  | { fieldId: FieldId; value: unknown }

/**
 * Single match returned by the lookup. `matchedBy` echoes the candidate that
 * hit this record (its `systemAttribute` or `fieldId`), useful when callers want
 * to know whether dedup succeeded via externalId vs. primary_email. The
 * denormalized display columns from EntityInstance ride along so list-style
 * consumers (e.g. the extension's "N similar found" view) can render an avatar +
 * name + subtitle without a second round-trip.
 */
export type LookupMatch = {
  recordId: RecordId
  matchedBy: { systemAttribute?: string; fieldId?: FieldId; value: unknown }
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
}

/**
 * Result envelope. `hasMore` is set when the lookup found more than `limit`
 * distinct records across the candidate list.
 */
export type LookupByFieldResult = {
  items: LookupMatch[]
  hasMore: boolean
}

/** Parameters for {@link lookupEntitiesByFieldValue}. */
export interface LookupEntitiesByFieldValueParams {
  organizationId: string
  /**
   * CANONICAL `EntityDefinition.id` — used to key the field cache, the
   * `RecordIdentity` index and the returned `RecordId`s. Callers resolving from
   * a slug must canonicalize first.
   */
  entityDefinitionId: string
  candidates: LookupCandidate[]
  limit: number
  /**
   * Extra SQL predicate on `EntityInstance` (permission record-scope). The
   * caller resolves its visibility arm; `arm: 'none'` must short-circuit to an
   * empty result WITHOUT calling this function.
   */
  scopeWhere?: SQL
  /**
   * Exclude archived records. Default `false` — include-archived is the
   * dedupe-correct default (re-capture of an archived contact should link to
   * the same row rather than create a duplicate). Import planning and other
   * "active records only" callers opt in.
   */
  excludeArchived?: boolean
  /**
   * Compare `valueText`-backed candidates case-INSENSITIVELY
   * (`lower(col) = lower(val)`). Default `false`, no existing caller moves.
   *
   * The CSV importer opts in so its identifier path agrees with its own
   * relation path, which has always been case-insensitive: today `m400l` links
   * to a stored `M400L` through a relation column and does *not* match it as an
   * identifier, inside one file. `normalizeForLookup` and `checkUniqueValueTyped`
   * stay case-SENSITIVE and stay in agreement with each other.
   *
   * `lower(col) = lower(val)`, never `ilike`: ILIKE reads its right operand
   * as a PATTERN and a raw CSV cell is not one (`_` matches any character, `%`
   * any sequence, both ordinary in SKUs and email local parts).
   */
  caseInsensitiveText?: boolean
  /**
   * AND the candidates instead of OR-ing them: only records matching EVERY
   * candidate are returned. Default `false` (OR / first-wins, today's
   * behaviour). This is the composite natural key, `(part, supplier)`, that
   * neither the importer nor the connector sink could express.
   *
   * Two rules follow from the mode and are enforced below:
   *  - the per-candidate record sets are intersected IN SQL, before any dedupe
   *    or limit. The OR path dedupes hits across candidates by recordId, which
   *    is only meaningful for OR; intersecting after a per-candidate `limit`
   *    would drop members of the intersection.
   *  - an unresolvable / uncoercible candidate makes the WHOLE lookup return
   *    empty. Skipping it (what OR does) would silently WIDEN an AND match.
   */
  matchAll?: boolean
  /**
   * What to do when more than one distinct record matches.
   *
   * **REQUIRED, and deliberately has no default.** The two consumers of this
   * function disagree on purpose, so a shared default would silently make one of
   * them wrong, and the one it would break is the importer, by reintroducing
   * "update an arbitrary record", which is the exact defect the update-strategy
   * work exists to kill. Every call site states its own policy.
   *
   * - `'first'`, return the matches in priority order and let the caller pick.
   *   The connector sink means this: a sync must not fail on data the user can
   *   only fix by merging, so it takes the first and files a
   *   `DuplicateSuggestion`.
   * - `'error'`, return {@link AmbiguousLookupError} naming the count. The CSV
   *   importer means this: an import is interactive, the user is present and the
   *   file is in front of them, so updating an arbitrary one of two records that
   *   share a SKU is a wrong write, not a missed one.
   */
  onAmbiguous: OnAmbiguous
}

/**
 * Parse an `external_id` value (`"<source>:<value>"`, e.g. `"gmail:jane@x.com"`,
 * `"website:acme.com"`) into a `RecordIdentity` `(source, externalId)`. The
 * `external_id` array attribute is retired; app-less external ids now live in
 * the identity index, so both the extension dedupe lookup and its create-write
 * route through this. Returns `null` for unprefixed / malformed values.
 */
export function parseExternalIdentity(raw: unknown): { source: string; externalId: string } | null {
  if (typeof raw !== 'string') return null
  const idx = raw.indexOf(':')
  if (idx <= 0 || idx >= raw.length - 1) return null
  return { source: raw.slice(0, idx), externalId: raw.slice(idx + 1) }
}

/**
 * Build a typed equality condition on the right FieldValue column for a
 * given field + raw value. Returns `null` when the value can't be
 * coerced / normalized (uncoercible inputs like `Number('foo')` leak
 * through `createTypedValueInput` as NaN and would silently match zero
 * rows — gate explicitly instead).
 */
export function buildLookupCondition(
  field: CustomFieldEntity,
  rawValue: unknown,
  options?: { caseInsensitiveText?: boolean }
): SQL | null {
  const normalized = normalizeForLookup(field.type as FieldType, rawValue)
  if (normalized === null || normalized === undefined) return null

  const typedInput = createTypedValueInput(field.type, normalized)
  if (typedInput === null) return null

  // `createTypedValueInput` does `Number(raw)` / `new Date(raw)` without
  // validating the result — gate explicitly.
  if (typedInput.type === 'number' && !Number.isFinite(typedInput.value)) return null
  if (typedInput.type === 'date' && Number.isNaN(new Date(typedInput.value).getTime())) {
    return null
  }

  const { column, value } = typedColumnMatch(typedInput)
  const col = schema.FieldValue[column] as AnyColumn

  // Case-insensitive comparison is opt-in and reaches only the TEXT-backed
  // column, `valueText` is exactly the set of string-shaped types (TEXT,
  // RICH_TEXT, ADDRESS, EMAIL, URL, PHONE_INTL); numbers, dates, options and
  // relations are keyed by id or by value and have no case.
  //
  // `lower(col) = lower(val)`, NEVER `ilike(col, val)`. ILIKE treats its
  // right operand as a PATTERN: `_` matches any single character and `%` any
  // sequence, both ordinary in SKUs and email local parts. This comparison
  // decides create-vs-update on the import path, so a false match is a WRONG
  // WRITE onto someone else's record, not a missed one.
  if (options?.caseInsensitiveText && column === 'valueText' && typeof value === 'string') {
    return eq(sql`lower(${col})`, value.toLowerCase())
  }

  return eq(col, value as string | number | boolean)
}

/**
 * Correlated `EXISTS` on FieldValue for one AND-mode candidate. Lives in the
 * outer query's WHERE clause, where Drizzle renders Column chunks fully
 * qualified, a correlated subquery in a SELECT *projection* would lose its
 * table qualifier and silently bind to the inner table instead.
 */
function fieldValueExists(organizationId: string, fieldId: string, condition: SQL): SQL {
  return sql`exists (select 1 from ${schema.FieldValue} where ${and(
    eq(schema.FieldValue.entityId, schema.EntityInstance.id),
    eq(schema.FieldValue.organizationId, organizationId),
    eq(schema.FieldValue.fieldId, fieldId),
    condition
  )})`
}

/** Correlated `EXISTS` on RecordIdentity for one AND-mode `external_id` candidate. */
function recordIdentityExists(
  organizationId: string,
  entityDefinitionId: string,
  parsed: { source: string; externalId: string }
): SQL {
  return sql`exists (select 1 from ${schema.RecordIdentity} where ${and(
    eq(schema.RecordIdentity.entityInstanceId, schema.EntityInstance.id),
    eq(schema.RecordIdentity.organizationId, organizationId),
    eq(schema.RecordIdentity.entityDefinitionId, entityDefinitionId),
    eq(schema.RecordIdentity.source, parsed.source),
    eq(schema.RecordIdentity.externalId, parsed.externalId)
  )})`
}

/**
 * Lookup record IDs by one or more `(systemAttribute, value)` /
 * `(fieldId, value)` candidates, tried in priority order. Column-aware (routes
 * through `typedColumnMatch`) and value-normalizing (mirrors write-path
 * formatting: EMAIL lowercased, URL protocol-prefixed, PHONE E.164).
 * Deduplicates hits across candidates by recordId; the earliest-priority
 * candidate wins attribution. Row-level `eq()` on the typed column +
 * `DISTINCT ON (entityId)` — multi-value fields match on ANY value row.
 * Ordering is deterministic (entityId, then sortKey).
 *
 * Candidate failure handling: a candidate whose field doesn't exist OR whose
 * value can't be coerced / normalized is **skipped with a warning log**, never
 * an error — including when EVERY candidate fails, which returns an empty
 * result. An unparseable VALUE is data, not a malformed call: nothing in the
 * table can equal `+190239478` once libphonenumber refuses to parse it, so
 * "no candidate could match" is an empty result, not a 400.
 *
 * This used to `err(BadRequestError)` on the all-fail case, which made the same
 * garbage input fatal or harmless depending only on how many OTHER candidates
 * the caller happened to pass — and the all-fail case is where the blast radius
 * is largest, not smallest. It cost a whole connector sync: one Quo contact
 * carrying a malformed phone as its only `match` key threw out of
 * `crud.lookupByField` (which unwraps by throwing), past `entity-sink`'s
 * `resolveIdentity`, up through the slice loop — whose catch rethrows anything
 * that is not a rate limit or an abort — and the RUN closed as failed. 57 of
 * the 4222 numbers in that address book are unparseable, so the first one hit
 * ended the sync. `import/planning/find-existing-record.ts` had already written
 * "sole candidate uncoercible — no match" locally, which is the same conclusion
 * reached one caller at a time; it belongs here instead.
 *
 * Does not filter on `capabilities.hidden`: the extension is a system
 * integration and is allowed to address hidden fields (externalId).
 *
 * `matchAll: true` flips the candidate list from OR to AND, the composite
 * natural key. The intersection happens in SQL (correlated `EXISTS` per
 * candidate) rather than over the OR loop's results, and an unusable candidate
 * empties the whole lookup instead of being skipped. See the param docs.
 *
 * `onAmbiguous: 'error'` turns "more than one distinct record matched" into an
 * {@link AmbiguousLookupError} carrying the count, for callers that must not
 * pick arbitrarily. Absent ⇒ `'first'`.
 */
export async function lookupEntitiesByFieldValue(
  db: Database,
  params: LookupEntitiesByFieldValueParams
): Promise<Result<LookupByFieldResult, Error>> {
  const { organizationId, entityDefinitionId, candidates, limit } = params
  const archivedFilter = params.excludeArchived
    ? isNull(schema.EntityInstance.archivedAt)
    : undefined

  const seen = new Set<RecordId>()
  const items: LookupMatch[] = []
  let hasMore = false
  let anyValid = false
  const skipped: Array<{ candidate: LookupCandidate; reason: string }> = []

  // Candidates resolve through the same `customFields` cache the crud handler
  // reads — fetched once here, not per candidate. Keyed by `CustomField.id`
  // (every DB-backed field, incl. system fields whose ResourceFieldId carries
  // the UUID); a systemAttribute fallback covers the pure-static-field edge so
  // a `{ fieldId }` candidate never silently misses.
  const fieldMap = await getCachedFieldMap(organizationId, entityDefinitionId)
  const resolveField = (candidate: LookupCandidate): CustomFieldEntity | null => {
    if ('fieldId' in candidate) {
      const byId = fieldMap.get(candidate.fieldId)
      if (byId) return byId
      for (const f of fieldMap.values()) if (f.systemAttribute === candidate.fieldId) return f
      return null
    }
    for (const f of fieldMap.values()) {
      if (f.systemAttribute === candidate.systemAttribute) return f
    }
    return null
  }

  // ── AND mode ────────────────────────────────────────────────────────────
  // Intersect the per-candidate record sets IN SQL, before any dedupe or limit.
  // Doing it after would be wrong twice over: the OR loop's dedupe-by-recordId
  // is a UNION operator, and a per-candidate `limit` can drop a record that IS
  // in the intersection.
  if (params.matchAll) {
    const existsConditions: SQL[] = []

    for (const candidate of candidates) {
      if ('systemAttribute' in candidate && candidate.systemAttribute === 'external_id') {
        const parsed = parseExternalIdentity(candidate.value)
        // An unusable candidate makes the whole AND return EMPTY. Skipping it
        // (what the OR loop does) would drop a conjunct and silently WIDEN the
        // match, an `(sku AND supplier)` key would degrade to `sku` alone.
        if (!parsed) {
          logger.warn('lookupEntitiesByFieldValue: AND candidate unusable, empty result', {
            entityDef: entityDefinitionId,
            reason: 'unparseable external_id',
          })
          return ok({ items: [], hasMore: false })
        }
        existsConditions.push(recordIdentityExists(organizationId, entityDefinitionId, parsed))
        continue
      }

      const field = resolveField(candidate)
      if (!field) {
        logger.warn('lookupEntitiesByFieldValue: AND candidate unusable, empty result', {
          entityDef: entityDefinitionId,
          reason: 'field not found',
        })
        return ok({ items: [], hasMore: false })
      }
      const condition = buildLookupCondition(field, candidate.value, {
        caseInsensitiveText: params.caseInsensitiveText,
      })
      if (condition === null) {
        logger.warn('lookupEntitiesByFieldValue: AND candidate unusable, empty result', {
          entityDef: entityDefinitionId,
          reason: 'uncoercible value',
        })
        return ok({ items: [], hasMore: false })
      }
      existsConditions.push(fieldValueExists(organizationId, field.id, condition))
    }

    if (existsConditions.length === 0) return ok({ items: [], hasMore: false })

    // `organizationId` + `entityDefinitionId` are the tenancy/def scope the OR
    // path gets implicitly from `FieldValue.fieldId` (a field belongs to one
    // def in one org). Anchoring on EntityInstance means stating them.
    const rows = await db
      .select({
        entityId: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
        avatarUrl: schema.EntityInstance.avatarUrl,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          archivedFilter,
          params.scopeWhere,
          ...existsConditions
        )
      )
      .orderBy(asc(schema.EntityInstance.id))
      .limit(limit + 1)

    // Attribution goes to the FIRST candidate: with AND every candidate matched,
    // so "which one hit" has no answer, the tuple did.
    const first = candidates[0]!
    for (const row of rows) {
      if (items.length >= limit) {
        hasMore = true
        break
      }
      items.push({
        recordId: toRecordId(entityDefinitionId, row.entityId),
        matchedBy:
          'fieldId' in first
            ? { fieldId: first.fieldId, value: first.value }
            : { systemAttribute: first.systemAttribute, value: first.value },
        displayName: row.displayName,
        secondaryDisplayValue: row.secondaryDisplayValue,
        avatarUrl: row.avatarUrl,
      })
    }

    return finish(items, hasMore, params.onAmbiguous)
  }

  for (const candidate of candidates) {
    if (items.length >= limit) break

    // `external_id` is retired as a FieldValue attribute — resolve it against
    // the `RecordIdentity` index instead (app-less link, source-scoped).
    if ('systemAttribute' in candidate && candidate.systemAttribute === 'external_id') {
      const parsed = parseExternalIdentity(candidate.value)
      if (!parsed) {
        skipped.push({ candidate, reason: 'unparseable external_id' })
        continue
      }
      anyValid = true
      const remaining = limit - items.length
      const rows = await db
        .select({
          entityId: schema.RecordIdentity.entityInstanceId,
          displayName: schema.EntityInstance.displayName,
          secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
          avatarUrl: schema.EntityInstance.avatarUrl,
        })
        .from(schema.RecordIdentity)
        .innerJoin(
          schema.EntityInstance,
          eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId)
        )
        .where(
          and(
            eq(schema.RecordIdentity.organizationId, organizationId),
            eq(schema.RecordIdentity.entityDefinitionId, entityDefinitionId),
            eq(schema.RecordIdentity.source, parsed.source),
            eq(schema.RecordIdentity.externalId, parsed.externalId),
            archivedFilter,
            params.scopeWhere
          )
        )
        .orderBy(asc(schema.RecordIdentity.entityInstanceId))
        .limit(remaining + 1)
      for (const row of rows) {
        const recordId = toRecordId(entityDefinitionId, row.entityId)
        if (seen.has(recordId)) continue
        if (items.length >= limit) {
          hasMore = true
          break
        }
        seen.add(recordId)
        items.push({
          recordId,
          matchedBy: { systemAttribute: candidate.systemAttribute, value: candidate.value },
          displayName: row.displayName,
          secondaryDisplayValue: row.secondaryDisplayValue,
          avatarUrl: row.avatarUrl,
        })
      }
      continue
    }

    const field = resolveField(candidate)
    if (!field) {
      skipped.push({ candidate, reason: 'field not found' })
      continue
    }

    const condition = buildLookupCondition(field, candidate.value, {
      caseInsensitiveText: params.caseInsensitiveText,
    })
    if (condition === null) {
      skipped.push({ candidate, reason: 'uncoercible value' })
      continue
    }
    anyValid = true

    // Fetch `remaining + 1` to detect hasMore. DISTINCT ON collapses
    // duplicate FieldValue rows on the same entity (e.g. belt-and-braces
    // against two rows with the same externalId after mode:'add' dedup).
    // Inner-join EntityInstance so each match carries the denormalized
    // displayName / secondaryDisplayValue / avatarUrl columns that the
    // FieldValueService write path keeps in sync. DISTINCT ON requires the
    // ORDER BY to lead with entityId; sortKey second keeps the picked row
    // (and thus result order) deterministic.
    const remaining = limit - items.length
    const rows = await db
      .selectDistinctOn([schema.FieldValue.entityId], {
        entityId: schema.FieldValue.entityId,
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
        avatarUrl: schema.EntityInstance.avatarUrl,
      })
      .from(schema.FieldValue)
      .innerJoin(
        schema.EntityInstance,
        and(
          eq(schema.EntityInstance.id, schema.FieldValue.entityId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.fieldId, field.id),
          eq(schema.FieldValue.organizationId, organizationId),
          condition,
          archivedFilter,
          params.scopeWhere
        )
      )
      .orderBy(asc(schema.FieldValue.entityId), asc(schema.FieldValue.sortKey))
      .limit(remaining + 1)

    for (const row of rows) {
      const recordId = toRecordId(entityDefinitionId, row.entityId)
      if (seen.has(recordId)) continue
      if (items.length >= limit) {
        hasMore = true
        break
      }
      seen.add(recordId)
      items.push({
        recordId,
        matchedBy:
          'fieldId' in candidate
            ? { fieldId: candidate.fieldId, value: candidate.value }
            : { systemAttribute: candidate.systemAttribute, value: candidate.value },
        displayName: row.displayName,
        secondaryDisplayValue: row.secondaryDisplayValue,
        avatarUrl: row.avatarUrl,
      })
    }
  }

  if (skipped.length > 0) {
    // `warn` when NOTHING was usable — the caller asked a question no query could
    // answer, which is worth noticing even though it is not an error. A partial
    // skip beside a valid candidate is informational.
    const payload = { entityDef: entityDefinitionId, allSkipped: !anyValid, skipped }
    if (anyValid) logger.info('lookupEntitiesByFieldValue: skipped candidates', payload)
    else logger.warn('lookupEntitiesByFieldValue: no candidate was usable', payload)
  }

  return finish(items, hasMore, params.onAmbiguous)
}

/**
 * Apply the ambiguity policy to a finished result set. Shared by the OR and AND
 * paths so the two can never disagree about what "more than one match" means.
 */
function finish(
  items: LookupMatch[],
  hasMore: boolean,
  onAmbiguous: OnAmbiguous | undefined
): Result<LookupByFieldResult, Error> {
  if (onAmbiguous === 'error' && items.length > 1) {
    return err(new AmbiguousLookupError(items.length, hasMore))
  }
  return ok({ items, hasMore })
}
