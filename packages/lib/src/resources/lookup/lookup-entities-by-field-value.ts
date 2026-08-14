// packages/lib/src/resources/lookup/lookup-entities-by-field-value.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { FieldId } from '@auxx/types/field'
import { createTypedValueInput } from '@auxx/types/field-value'
import { type AnyColumn, and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedFieldMap } from '../../cache'
import { BadRequestError } from '../../errors'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { typedColumnMatch } from '../../field-values/typed-column-match'
import { type RecordId, toRecordId } from '../resource-id'

const logger = createScopedLogger('lookup-entities-by-field-value')

type CustomFieldEntity = typeof schema.CustomField.$inferSelect

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
export function buildLookupCondition(field: CustomFieldEntity, rawValue: unknown): SQL | null {
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
  return eq(schema.FieldValue[column] as AnyColumn, value as string | number | boolean)
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
 * value can't be coerced / normalized is **skipped with a warning log**, not
 * an error. Only returns `err(BadRequestError)` when ALL candidates fail —
 * otherwise one garbage input would take down a best-effort fallback chain
 * (e.g. externalId → email).
 *
 * Does not filter on `capabilities.hidden`: the extension is a system
 * integration and is allowed to address hidden fields (externalId).
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

    const condition = buildLookupCondition(field, candidate.value)
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

  if (!anyValid && candidates.length > 0) {
    return err(
      new BadRequestError(
        `lookupEntitiesByFieldValue: no candidate was valid. Skipped: ${JSON.stringify(skipped)}`
      )
    )
  }
  if (skipped.length > 0) {
    logger.warn('lookupEntitiesByFieldValue: skipped candidates', {
      entityDef: entityDefinitionId,
      skipped,
    })
  }

  return ok({ items, hasMore })
}
