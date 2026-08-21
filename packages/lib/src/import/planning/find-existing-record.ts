// packages/lib/src/import/planning/find-existing-record.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import type { Resource, ResourceField } from '../../resources'
import {
  AmbiguousLookupError,
  type LookupCandidate,
  lookupEntitiesByFieldValue,
} from '../../resources/lookup/lookup-entities-by-field-value'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import { parseRecordId } from '../../resources/resource-id'
import type { BaseType } from '../../workflow-engine/core/types'
import { RELATION_MATCH_TEXT_TYPES } from '../resolution/relation-match-types'

const logger = createScopedLogger('find-existing-record')

/**
 * Map of system resource IDs to their Drizzle table definitions.
 * Used for querying system tables during import planning.
 */
// Contact, Ticket and Inbox tables have been dropped - they now use EntityInstance,
// so they have no entry here and fall through to the custom-entity lookup below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SYSTEM_TABLE_MAP: Record<string, PgTableWithColumns<any>> = {
  thread: schema.Thread,
  user: schema.User,
  participant: schema.Participant,
  message: schema.Message,
  dataset: schema.Dataset,
}

/**
 * Get the Drizzle table for a system resource.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSystemTable(resourceId: string): PgTableWithColumns<any> | undefined {
  return SYSTEM_TABLE_MAP[resourceId]
}

/**
 * Whether this resource takes the system-table lane below.
 *
 * Exported for `batch-identifier-lookup.ts`, which batches the custom-entity
 * lane only and needs to recognise the lane it does NOT own without restating
 * {@link SYSTEM_TABLE_MAP}.
 *
 * @param resourceId - `Resource.id`
 * @returns true when the identifier lookup queries a system table
 */
export function hasSystemTable(resourceId: string): boolean {
  return getSystemTable(resourceId) !== undefined
}

/**
 * Outcome of one identifier lookup.
 *
 * `ambiguous` is why this is a union and not `string | null`. The old shape
 * queried with `limit: 1`, so two records sharing a SKU silently updated an
 * arbitrary one of them, a wrong write, not a missed one, and `.limit(1)`
 * carries no ORDER BY so *which* record got clobbered was undefined. The
 * planner turns this into a row error naming the count, mirroring the relation
 * path (`resolve-relation-lookups.ts`).
 */
export type FindExistingRecordResult =
  | { kind: 'none' }
  | { kind: 'one'; recordId: string }
  | { kind: 'ambiguous'; count: number }

/**
 * Identifier values for one row, keyed by identifier field KEY.
 * Every key in `identifierFields` must be present and non-blank for a composite
 * key to match at all.
 */
export type IdentifierValues = Record<string, string>

/** Resolve one row's identifier tuple to an existing record. */
export type FindExistingRecord = (values: IdentifierValues) => Promise<FindExistingRecordResult>

/** Options for creating a findExistingRecord function */
export interface FindExistingRecordOptions {
  db: Database
  organizationId: string
  resource: Resource
  /**
   * Ordered identifier fields. ONE field is the ordinary case and behaves
   * exactly as it always has; TWO OR MORE is a composite natural key whose
   * candidates are ANDed, `(part, supplier)` for a supplier price list, where
   * no single field is unique by design.
   */
  identifierFields: ResourceField[]
}

/**
 * Create a function to find existing records by identifier value.
 * Dynamically queries the correct table and column based on resource definition.
 *
 * The lookup is deliberately NOT record-scoped. Import authority is
 * definition-level (`assertImportEntity` → `canImportRecord`, which already
 * carries an `edit` floor). Scoping this query would fail OPEN: a record the
 * importer may not touch simply would not match, so the row would be classified
 * `create` and silently duplicated. Making it safe needs a third outcome
 * ("exists but forbidden"), which is its own information-disclosure decision.
 * Do not bolt on the scoped lookup without it.
 */
export function createFindExistingRecord(options: FindExistingRecordOptions): FindExistingRecord {
  const { db, organizationId, resource, identifierFields } = options

  logger.info('Creating findExistingRecord function', {
    resourceId: resource.id,
    resourceType: resource.type,
    identifierKeys: identifierFields.map(getFieldOutputKey),
    composite: identifierFields.length > 1,
  })

  return async (values: IdentifierValues): Promise<FindExistingRecordResult> => {
    if (identifierFields.length === 0) return { kind: 'none' }

    // A composite key with a missing component cannot match ANYTHING. Falling
    // back to the components we do have would silently widen the key and update
    // the wrong record; the caller classifies the row per its mode instead.
    const tuple: Array<{ field: ResourceField; value: string }> = []
    for (const field of identifierFields) {
      // Keyed by OUTPUT key — what `analyzeRow` put in the record, and what the
      // mapping's `identifierFieldKeys` hold. `field.key` is the display name on
      // an entity-definition field and would never be present here.
      const value = values[getFieldOutputKey(field)]?.trim()
      if (!value) return { kind: 'none' }
      tuple.push({ field, value })
    }

    // System resources - use SYSTEM_TABLE_MAP
    const table = getSystemTable(resource.id)
    if (table) {
      const result = await findInSystemTable(db, table, organizationId, tuple)
      logger.debug('System table lookup', { resourceId: resource.id, result })
      return result
    }

    // Custom entities - query via FieldValue (or EntityInstance for `id`)
    if (resource.type === 'custom' && resource.entityDefinitionId) {
      const result = await findInCustomEntity(
        db,
        organizationId,
        resource.entityDefinitionId,
        tuple
      )
      logger.debug('Custom entity lookup', {
        entityDefinitionId: resource.entityDefinitionId,
        result,
      })
      return result
    }

    logger.warn('No lookup method available', {
      resourceId: resource.id,
      resourceType: resource.type,
    })
    return { kind: 'none' }
  }
}

/**
 * TEXT-shaped identifier types the importer compares case-insensitively.
 *
 * The set itself is `RELATION_MATCH_TEXT_TYPES`, which encodes the identical
 * fact for the relation resolver ("this type is backed by `valueText`, so
 * compare it with `LOWER()`"). Restating the four members here is how the two
 * lanes would come to disagree about whether `m400l` is `M400L`.
 *
 * `id` is excluded by the `dbColumn` check at the call site, not by type: a
 * record id is a cuid (already lower-case) and lowering it would only cost the
 * primary-key index.
 */
const CASE_INSENSITIVE_TYPES: ReadonlySet<BaseType> = new Set<BaseType>(RELATION_MATCH_TEXT_TYPES)

/**
 * Find a record in a system table by identifier field(s).
 *
 * Composite keys AND their column comparisons. `limit(2)`, one row past what
 * we need, is what makes ambiguity observable instead of arbitrary.
 */
async function findInSystemTable(
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  organizationId: string,
  tuple: Array<{ field: ResourceField; value: string }>
): Promise<FindExistingRecordResult> {
  // TEXT identifiers compare case-insensitively here for the same reason the
  // custom-entity branch opts into `caseInsensitiveText`: the two branches must
  // answer the same question the same way, or `part` and `contact` imports
  // disagree about whether `m400l` is `M400L`.
  //
  // `lower(col) = lower(value)`, NOT `ilike(col, value)`. ILIKE treats its right
  // operand as a PATTERN, and the raw CSV cell is not one: `_` matches any single
  // character and `%` any sequence. Underscores are ordinary in email local parts,
  // so `john_smith@acme.com` used to match a stored `johnXsmith@acme.com` — and
  // because this function decides create-vs-update, a false match makes the import
  // UPDATE a different person's record instead of creating a new one. A wrong
  // write, not a missed one.
  //
  // NOTE (2026-08-16): no registry-shipped system resource currently REACHES this
  // branch, so the fix above is defence-in-depth rather than a live repair. Both
  // EMAIL-typed system identifier fields are blocked upstream by separate pre-existing
  // bugs:
  //   • `user`        — `schema.User` has NO `organizationId` column (users belong to
  //                     an org through OrganizationMember), so the `eq(table.organizationId, …)`
  //                     below renders EMPTY and Postgres rejects the statement outright
  //                     (`where ( = $1 …)`, syntax error). User imports throw.
  //   • `participant` — the registry maps its email field to `dbColumn: 'email'`, but
  //                     `Participant` stores the address in `identifier`. `column` is
  //                     therefore undefined and the function returns null before it
  //                     ever compares — a silent, permanent no-match.
  // Fixing either means a decision (join OrganizationMember for user scoping; correct
  // or alias the participant column mapping), so both are left as-is and tracked.
  const comparisons = []
  for (const { field, value } of tuple) {
    const columnName = field.dbColumn ?? field.key
    const column = table[columnName]
    if (!column) return { kind: 'none' }

    const caseInsensitive = columnName !== 'id' && CASE_INSENSITIVE_TYPES.has(field.type)
    comparisons.push(
      caseInsensitive ? eq(sql`lower(${column})`, value.toLowerCase()) : eq(column, value)
    )
  }

  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, organizationId), ...comparisons))
    .limit(2)

  if (rows.length === 0) return { kind: 'none' }
  if (rows.length > 1) return { kind: 'ambiguous', count: rows.length }
  return { kind: 'one', recordId: rows[0]!.id as string }
}

/**
 * Tolerate a prefixed record id (`part:cm9x…`) alongside a bare cuid.
 *
 * NOT `parseRecordId`: on a bare cuid it returns
 * `{ entityDefinitionId: <cuid>, entityInstanceId: '' }` and `console.error`s,
 * which would turn every ordinary Record-ID cell into a silent no-match plus
 * noise. Split manually on the FIRST colon instead.
 *
 * Exported so `batch-identifier-lookup.ts` keys its index on the exact same
 * string this branch queries with.
 *
 * @param value - A raw Record-ID cell, prefixed or bare
 * @returns The bare instance id
 */
export function stripRecordIdPrefix(value: string): string {
  const idx = value.indexOf(':')
  return idx >= 0 ? value.slice(idx + 1) : value
}

/**
 * Find a record in a custom entity by identifier field value(s).
 *
 * Routes through the shared lookup core so the comparison mirrors write-path
 * normalization (EMAIL lowercased, URL protocol-prefixed, PHONE E.164 —
 * previously the raw CSV cell was compared against the normalized stored value
 * and could never match a `Foo@Bar.com` cell, the historic "uniqueness breaks
 * imports" root cause). Archived records are excluded — an import must never
 * resolve a row to a merged-away/archived record — and matching is
 * deterministic (entityId, sortKey ordering).
 *
 * Two or more identifier fields ANDs the candidates in SQL (`matchAll`), which
 * is what makes a `(part, supplier)` price list re-importable.
 */
async function findInCustomEntity(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  tuple: Array<{ field: ResourceField; value: string }>
): Promise<FindExistingRecordResult> {
  // ── Record ID ──────────────────────────────────────────────────────────
  // `id` can never resolve through the FieldValue lane. `resolveField` keys
  // the field map by `CustomField.id` and falls back to `systemAttribute`, but
  // the map holds only DB-backed rows and the seeder excludes `id`, so a
  // Record-ID identifier silently matched NOTHING and logged "no candidate was
  // usable". Branch before the lookup core; `id` is not a field value and must
  // not be taught to `resolveField`.
  //
  // `dbColumn === 'id'`, not `key === 'id'`: `key` is what the picker shows,
  // `dbColumn` is the claim that the field IS a physical column, exactly the
  // condition that makes the FieldValue path wrong.
  //
  // Prior art with the identical three predicates:
  // `resolution/resolve-relation-lookups.ts` (`matchField === 'id'`).
  const idEntries = tuple.filter((t) => t.field.dbColumn === 'id')
  const fieldEntries = tuple.filter((t) => t.field.dbColumn !== 'id')

  let idMatch: string | undefined
  if (idEntries.length > 0) {
    const ids = new Set(idEntries.map((e) => stripRecordIdPrefix(e.value)))
    // Two different ids in one composite key name two different records.
    if (ids.size > 1) return { kind: 'none' }

    const [row] = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          // The two scope predicates are the safety property, not boilerplate.
          // A cuid is unique across the WHOLE EntityInstance table, so
          // `eq(id, value)` alone resolves happily, and then a `part` import
          // updates a `contact`, or a row in another tenant. Covered by
          // `EntityInstance_organizationId_entityDefinitionId_idx`.
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          eq(schema.EntityInstance.id, [...ids][0]!),
          // Mirrors `excludeArchived: true` on the FieldValue lane, an import
          // must never resolve to a merged-away record.
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      // No `limit(2)` here, on purpose: `id` is the PRIMARY KEY, so the
      // ambiguity fix genuinely does not apply to this branch. Do not "fix" it
      // for symmetry with the branches below.
      .limit(1)

    if (!row) return { kind: 'none' }
    idMatch = row.id
    if (fieldEntries.length === 0) return { kind: 'one', recordId: idMatch }
  }

  // ── FieldValue lane ────────────────────────────────────────────────────
  const candidates: LookupCandidate[] = []
  for (const { field, value } of fieldEntries) {
    // Without a resolvable field id there is no candidate; for a composite key
    // that means the tuple cannot match at all.
    if (!field.id) return { kind: 'none' }
    candidates.push({ fieldId: field.id, value })
  }
  if (candidates.length === 0) return { kind: 'none' }

  const result = await lookupEntitiesByFieldValue(db, {
    organizationId,
    entityDefinitionId,
    candidates,
    // One past what we need: two hits is the ambiguity signal.
    limit: 2,
    // A single identifier field takes the OR path unchanged, AND of one
    // candidate is the same set, but staying on the original path keeps the
    // ordinary case byte-for-byte what it has always been.
    matchAll: candidates.length > 1,
    excludeArchived: true,
    // The importer's identifier path agrees with its own relation path, which
    // has always been case-insensitive. See the param docs on the lookup core.
    caseInsensitiveText: true,
    // An import is interactive: a hard row error naming the count beats
    // updating an arbitrary one of two records that share the value.
    onAmbiguous: 'error',
  })

  if (result.isErr()) {
    if (result.error instanceof AmbiguousLookupError) {
      return { kind: 'ambiguous', count: result.error.matchCount }
    }
    // A structural failure is NOT a "no match", surfacing it as one is the
    // fail-open that turns a transient DB error into a duplicate record. Throw
    // so `analyzeRow` records a row error.
    throw result.error
  }

  const match = result.value.items[0]
  if (!match) return { kind: 'none' }

  const instanceId = parseRecordId(match.recordId).entityInstanceId
  // A composite key that also carried `id` must agree with the field lane.
  if (idMatch && idMatch !== instanceId) return { kind: 'none' }
  return { kind: 'one', recordId: instanceId }
}
