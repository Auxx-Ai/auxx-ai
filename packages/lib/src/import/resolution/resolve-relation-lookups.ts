// packages/lib/src/import/resolution/resolve-relation-lookups.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { getCachedResource } from '../../cache'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import type { CustomResource, Resource, SystemResource } from '../../resources/registry/types'
import { BaseType } from '../../resources/types'
import type {
  RelationCreateRequest,
  RelationLinkMode,
  RelationOnNoMatch,
  ResolvedValue,
} from '../types/resolution'
import { buildImportAuthority, type ImportAuthorityOptions } from './import-authority'
import {
  RELATION_MATCH_ARRAY_TYPES,
  RELATION_MATCH_ENUM_TYPES,
  RELATION_MATCH_NUMERIC_TYPES,
  RELATION_MATCH_TEXT_TYPES,
} from './relation-match-types'
import { canCreateOnNoMatch, resolveDisplayFieldKey } from './relation-policy'
import { updateResolutionsByHash } from './write-resolution-rows'

const logger = createScopedLogger('resolve-relation-lookups')

/**
 * The `BaseType` set this resolver can actually match on, re-exported from the
 * module that owns it so the wizard's match-field picker filters against the
 * resolver's own answer instead of restating it (03 §5.4).
 *
 * Never merge this with the identifier type gate, that one is policy, this
 * one is a hard technical limit of `queryCustomEntity`'s typed-column lanes.
 */
export {
  isRelationMatchableType,
  RELATION_MATCH_ARRAY_TYPES,
  RELATION_MATCH_ENUM_TYPES,
  RELATION_MATCH_NUMERIC_TYPES,
  RELATION_MATCH_TEXT_TYPES,
  RELATION_MATCHABLE_BASE_TYPES,
} from './relation-match-types'

/** Field types that support text matching */
const TEXT_FIELD_TYPES: readonly BaseType[] = RELATION_MATCH_TEXT_TYPES

/** Field types that support numeric matching */
const NUMERIC_FIELD_TYPES: readonly BaseType[] = RELATION_MATCH_NUMERIC_TYPES

/** Field types that use option matching */
const ENUM_FIELD_TYPES: readonly BaseType[] = RELATION_MATCH_ENUM_TYPES

/** Field types that support array contains matching */
const ARRAY_FIELD_TYPES: readonly BaseType[] = RELATION_MATCH_ARRAY_TYPES

/** Pending relation lookup extracted from resolution */
export interface PendingRelationLookup {
  /** Hash of the original value (for updating resolution) */
  hash: string
  /** ImportJobProperty ID */
  jobPropertyId: string
  /** Target entity definition ID (e.g., 'contact', 'ticket', or custom entity UUID) */
  entityDefinitionId: string
  /** Field to match on (e.g., 'email', 'name') */
  matchField: string
  /** Value to search for */
  searchValue: string
  /**
   * What to do when nothing matches. Absent ⇒ `'fail'`, the behaviour every
   * relation column had before the policy existed.
   */
  onNoMatch?: RelationOnNoMatch
  /** Replace-or-append policy for a multi-valued relation on the update path */
  linkMode?: RelationLinkMode
  /** Whether this is a direct ID lookup */
  isDirectId?: boolean
}

/** How one pending lookup came out */
export type RelationLookupOutcome = 'matched' | 'create' | 'blank' | 'error'

/** Result of a relation lookup */
export interface RelationLookupResult {
  hash: string
  jobPropertyId: string
  recordId: string | null
  /** `'matched'` when `recordId` is set; see {@link RelationLookupOutcome} */
  outcome: RelationLookupOutcome
  /**
   * Present only on `outcome: 'create'`, what `materializeRelationCreates`
   * must mint at execution time. Nothing is written here: a plan the user
   * abandons at the preview must leave no records behind.
   */
  create?: RelationCreateRequest
  error?: string
}

/**
 * Options for {@link resolveRelationLookups}.
 *
 * The relation TARGET's import gate is asked separately from the import's own,
 * see {@link ImportAuthorityOptions}. Fail-closed: with neither `userId` nor
 * `canImportTarget`, every `'create'` becomes a row error naming the missing
 * check.
 */
export type ResolveRelationLookupsOptions = ImportAuthorityOptions

/**
 * Resolve pending relation lookups by batch querying the database.
 * Groups lookups by target table for efficient querying.
 */
export async function resolveRelationLookups(
  db: Database,
  organizationId: string,
  pendingLookups: PendingRelationLookup[],
  options: ResolveRelationLookupsOptions = {}
): Promise<RelationLookupResult[]> {
  if (pendingLookups.length === 0) {
    return []
  }

  logger.info('Resolving relation lookups', {
    count: pendingLookups.length,
    tables: [...new Set(pendingLookups.map((l) => l.entityDefinitionId))],
  })

  const results: RelationLookupResult[] = []
  const canImportTarget = buildImportAuthority(organizationId, options)

  // Group by entity definition for batch queries
  const byEntity = new Map<string, PendingRelationLookup[]>()
  for (const lookup of pendingLookups) {
    const existing = byEntity.get(lookup.entityDefinitionId) ?? []
    existing.push(lookup)
    byEntity.set(lookup.entityDefinitionId, existing)
  }

  // Process each entity
  for (const [entityDefinitionId, lookups] of byEntity) {
    const tableResults = await resolveLookupsForTable(
      db,
      organizationId,
      entityDefinitionId,
      lookups,
      canImportTarget
    )
    results.push(...tableResults)
  }

  logger.info('Relation lookups complete', {
    total: pendingLookups.length,
    resolved: results.filter((r) => r.recordId).length,
    toCreate: results.filter((r) => r.outcome === 'create').length,
    blanked: results.filter((r) => r.outcome === 'blank').length,
    errors: results.filter((r) => r.error).length,
  })

  return results
}

/**
 * Resolve lookups for a single target table
 */
async function resolveLookupsForTable(
  db: Database,
  organizationId: string,
  targetTable: string,
  lookups: PendingRelationLookup[],
  canImportTarget: (entityDefinitionId: string) => Promise<boolean>
): Promise<RelationLookupResult[]> {
  // Get resource definition from org cache
  const resource = await getCachedResource(organizationId, targetTable)
  if (!resource) {
    logger.warn('Target table not found', { targetTable })
    return lookups.map((l) => ({
      hash: l.hash,
      jobPropertyId: l.jobPropertyId,
      recordId: null,
      outcome: 'error' as const,
      error: `Resource not found: ${targetTable}`,
    }))
  }

  // Defect E. The default match field is resolved to the display field's
  // KEY through the resource's own fields, `primaryDisplayField.name` is the
  // human LABEL (`Company Name`, `Title`), and trusting it made every
  // auto-mapped relation column report "No match found" for every value.
  const defaultMatchField = resolveDisplayFieldKey(resource)

  // Group lookups by match field (most will use the same field)
  const byMatchField = new Map<string, PendingRelationLookup[]>()
  for (const lookup of lookups) {
    const field = lookup.matchField || defaultMatchField
    const existing = byMatchField.get(field) ?? []
    existing.push({ ...lookup, matchField: field })
    byMatchField.set(field, existing)
  }

  const results: RelationLookupResult[] = []

  for (const [matchField, fieldLookups] of byMatchField) {
    const fieldType = resource.fields.find((f) => f.key === matchField)?.type
    const searchValues = fieldLookups.map((l) => normalizeSearchValue(l.searchValue, fieldType))

    // Query records matching any of the search values
    const records = await queryRecordsByField(
      db,
      organizationId,
      resource,
      matchField,
      searchValues
    )

    // Build lookup map: normalizedSearchValue -> recordIds. A value carried by
    // MORE than one record is an ambiguity — resolved as a row error below,
    // never last-write-wins (silently linking to an arbitrary record).
    const recordMap = new Map<string, Set<string>>()
    for (const record of records) {
      const fieldValue = record[matchField]
      if (fieldValue != null) {
        const normalizedKey = String(fieldValue).toLowerCase().trim()
        const ids = recordMap.get(normalizedKey) ?? new Set<string>()
        ids.add(record.id)
        recordMap.set(normalizedKey, ids)
      }
    }

    // Whether auto-create is even legal for this (resource, matchField)
    // pair is asked ONCE per group, not per value: it is a property of the
    // column, and the authority read behind it is a cache hit either way.
    const createAllowedForField = canCreateOnNoMatch(resource, matchField)
    let createAuthorized: boolean | null = null

    // Map results
    for (let i = 0; i < fieldLookups.length; i++) {
      const lookup = fieldLookups[i]!
      const matched = recordMap.get(searchValues[i]!)

      // Ambiguity is a row error unconditionally and is checked BEFORE any
      // policy branch. It is deliberately not configurable: guessing which
      // `Acme` was meant is the one wrong link nobody can detect afterwards.
      if (matched && matched.size > 1) {
        results.push({
          hash: lookup.hash,
          jobPropertyId: lookup.jobPropertyId,
          recordId: null,
          outcome: 'error',
          error: `Ambiguous match for "${lookup.searchValue}": ${matched.size} records share this value`,
        })
        continue
      }

      if (matched && matched.size === 1) {
        results.push({
          hash: lookup.hash,
          jobPropertyId: lookup.jobPropertyId,
          recordId: [...matched][0]!,
          outcome: 'matched',
        })
        continue
      }

      const policy: RelationOnNoMatch = lookup.onNoMatch ?? 'fail'

      if (policy === 'blank') {
        results.push({
          hash: lookup.hash,
          jobPropertyId: lookup.jobPropertyId,
          recordId: null,
          outcome: 'blank',
        })
        continue
      }

      if (policy === 'create') {
        if (!createAllowedForField) {
          results.push({
            hash: lookup.hash,
            jobPropertyId: lookup.jobPropertyId,
            recordId: null,
            outcome: 'error',
            error: `No match found for "${lookup.searchValue}", it cannot be created because "${matchField}" is not ${resource.label}'s display field`,
          })
          continue
        }
        createAuthorized ??= await canImportTarget(resource.entityDefinitionId)
        if (!createAuthorized) {
          results.push({
            hash: lookup.hash,
            jobPropertyId: lookup.jobPropertyId,
            recordId: null,
            outcome: 'error',
            error: `No match found for "${lookup.searchValue}", you don't have permission to create ${resource.label} records`,
          })
          continue
        }
        results.push({
          hash: lookup.hash,
          jobPropertyId: lookup.jobPropertyId,
          recordId: null,
          outcome: 'create',
          create: {
            entityDefinitionId: resource.entityDefinitionId,
            matchField,
            // The RAW cell, never the lowercased search key, the search key
            // exists to match, not to become a record's name.
            value: lookup.searchValue,
          },
        })
        continue
      }

      results.push({
        hash: lookup.hash,
        jobPropertyId: lookup.jobPropertyId,
        recordId: null,
        outcome: 'error',
        error: `No match found for "${lookup.searchValue}"`,
      })
    }
  }

  return results
}

/**
 * Normalize a relation search value to write-path shape so it can match stored
 * values: EMAIL lowercased, URL `https://`-prefixed + lowercased, PHONE E.164.
 * Lowercase-only normalization can never match a stored URL/phone — the write
 * path stores `https://acme.com` and `+14155551234`. Falls back to
 * lowercase+trim when the value doesn't parse (it then simply finds no match)
 * or when the field type carries no normalization.
 */
function normalizeSearchValue(rawValue: string, fieldType: BaseType | undefined): string {
  const fallback = rawValue.toLowerCase().trim()
  const dbType =
    fieldType === BaseType.EMAIL
      ? ('EMAIL' as const)
      : fieldType === BaseType.URL
        ? ('URL' as const)
        : fieldType === BaseType.PHONE
          ? ('PHONE_INTL' as const)
          : null
  if (!dbType) return fallback
  const normalized = normalizeForLookup(dbType, rawValue)
  // The SQL side compares LOWER(column) — keep the key lowercase.
  return typeof normalized === 'string' ? normalized.toLowerCase() : fallback
}

/**
 * Query records by field value using IN clause for batch efficiency.
 * Uses cached resource data from ResourceRegistryService.
 */
async function queryRecordsByField(
  db: Database,
  organizationId: string,
  resource: Resource,
  matchField: string,
  searchValues: string[]
): Promise<Array<{ id: string; [key: string]: unknown }>> {
  if (searchValues.length === 0) {
    return []
  }

  if (resource.type === 'system') {
    return querySystemResource(db, organizationId, resource, matchField, searchValues)
  } else {
    return queryCustomEntity(db, organizationId, resource, matchField, searchValues)
  }
}

/** Conservative SQL-identifier shape for interpolated column names. */
const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Query system resource (contact, ticket, etc.)
 * Uses raw SQL for flexible dynamic column access.
 */
async function querySystemResource(
  db: Database,
  organizationId: string,
  resource: SystemResource,
  matchField: string,
  searchValues: string[]
): Promise<Array<{ id: string; [key: string]: unknown }>> {
  // Use raw SQL query for flexibility with dynamic table/column names
  // This avoids TypeScript issues with dynamic schema access
  const tableName = resource.dbName

  // `matchField` is mapping-supplied and reaches `sql.raw` — gate it against
  // the resource's registered fields (plus identifier shape) so a crafted
  // mapping cannot inject SQL through the column position.
  const isKnownField =
    matchField === 'id' ||
    resource.fields.some((f) => f.key === matchField || f.dbColumn === matchField)
  if (!isKnownField || !SAFE_SQL_IDENTIFIER.test(matchField)) {
    logger.warn('Rejected unsafe or unknown matchField for system resource lookup', {
      resourceId: resource.id,
      matchField,
    })
    return []
  }

  // Build the SQL query with proper escaping
  const results = await db.execute<{ id: string; [key: string]: unknown }>(
    sql`SELECT * FROM "${sql.raw(tableName)}"
        WHERE "organizationId" = ${organizationId}
        AND LOWER("${sql.raw(matchField)}") = ANY(${searchValues})
        LIMIT ${searchValues.length * 2}`
  )

  return results.rows as Array<{ id: string; [key: string]: unknown }>
}

/**
 * Query custom entity instances.
 * Uses entityDefinitionId and field.id from already-cached resource data.
 * Handles different field types with typed FieldValue column queries.
 */
async function queryCustomEntity(
  db: Database,
  organizationId: string,
  resource: CustomResource,
  matchField: string,
  searchValues: string[]
): Promise<Array<{ id: string; [key: string]: unknown }>> {
  const entityDefinitionId = resource.entityDefinitionId

  // For 'id' field, query EntityInstance directly
  if (matchField === 'id') {
    const instances = await db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        inArray(schema.EntityInstance.id, searchValues),
        isNull(schema.EntityInstance.archivedAt)
      ),
    })
    return instances.map((i) => ({ id: i.id }))
  }

  // Find field from already-loaded resource.fields (no DB query needed)
  const field = resource.fields.find((f) => f.key === matchField)
  if (!field?.id) {
    logger.warn('Custom field not found in cached resource', {
      targetTable: resource.id,
      matchField,
      availableFields: resource.fields.map((f) => f.key),
    })
    return []
  }

  // Build type-appropriate query condition using FieldValue typed columns
  let matchCondition: SQL<unknown>
  let valueColumn: string

  if (TEXT_FIELD_TYPES.includes(field.type)) {
    // Text types: case-insensitive match on valueText
    valueColumn = 'valueText'
    matchCondition = sql`LOWER(${schema.FieldValue.valueText}) = ANY(${searchValues})`
  } else if (NUMERIC_FIELD_TYPES.includes(field.type)) {
    // Numeric types: match on valueNumber
    valueColumn = 'valueNumber'
    const numericValues = searchValues.map((v) => parseFloat(v)).filter((n) => !Number.isNaN(n))
    if (numericValues.length === 0) return []
    matchCondition = inArray(schema.FieldValue.valueNumber, numericValues)
  } else if (ENUM_FIELD_TYPES.includes(field.type)) {
    // Enum/select types: match on optionId
    valueColumn = 'optionId'
    matchCondition = sql`LOWER(${schema.FieldValue.optionId}) = ANY(${searchValues})`
  } else if (ARRAY_FIELD_TYPES.includes(field.type)) {
    // Array/tags types: match on optionId (stored as multiple rows)
    valueColumn = 'optionId'
    matchCondition = sql`LOWER(${schema.FieldValue.optionId}) = ANY(${searchValues})`
  } else {
    // Unsupported field types (ADDRESS, OBJECT, etc.)
    logger.warn('Unsupported field type for relation matching', {
      targetTable: resource.id,
      matchField,
      fieldType: field.type,
    })
    return []
  }

  // Query with type-appropriate condition using FieldValue typed columns.
  // The organizationId predicate is load-bearing: FieldValue.fieldId alone
  // does scope to one org's CustomField row, but belt-and-braces here keeps
  // the query index-friendly and future-proof against shared field ids.
  const results = await db
    .select({
      entityId: schema.FieldValue.entityId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.FieldValue.entityId, schema.EntityInstance.id),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, field.id),
        matchCondition
      )
    )

  return results.map((r) => {
    // Extract the appropriate value based on column type
    let value: unknown
    if (valueColumn === 'valueText') {
      value = r.valueText
    } else if (valueColumn === 'valueNumber') {
      value = r.valueNumber
    } else if (valueColumn === 'optionId') {
      value = r.optionId
    }

    return {
      id: r.entityId,
      [matchField]: value,
    }
  })
}

/**
 * Translate one lookup outcome into the row shape `ImportValueResolution`
 * stores. Split out so the four outcomes are readable side by side and so the
 * `isValid` flag can never disagree with `status` again.
 */
function toResolutionRow(result: RelationLookupResult): {
  status: 'valid' | 'error' | 'create'
  resolvedValues: ResolvedValue[]
  isValid: boolean
} {
  switch (result.outcome) {
    case 'matched':
      return {
        status: 'valid',
        resolvedValues: [{ type: 'value', value: result.recordId }],
        isValid: true,
      }
    case 'create':
      // Nothing is minted yet, `materializeRelationCreates` does that at
      // execution time and rewrites this entry to a real record id. `value`
      // stays null so an unmaterialized run imports the row with NO link
      // rather than with the raw cell text masquerading as one.
      return {
        status: 'create',
        resolvedValues: [{ type: 'create', value: null, relationCreate: result.create }],
        isValid: true,
      }
    case 'blank':
      return {
        status: 'valid',
        resolvedValues: [{ type: 'value', value: null }],
        isValid: true,
      }
    default:
      return {
        status: 'error',
        resolvedValues: [{ type: 'error', error: result.error ?? 'Relation lookup failed' }],
        isValid: false,
      }
  }
}

/**
 * Update ImportValueResolution records with lookup results.
 *
 * `resolvedValues` is `jsonb().notNull()`. An earlier implementation set it to
 * SQL NULL on every non-match, which Postgres rejects, so a single unmatched
 * relation cell blew up the whole plan-generation job instead of marking one
 * value. Every branch now writes a real array.
 *
 * One statement per 500 values, not one per value: a 3k-supplier file used to
 * issue 3k sequential UPDATEs before planning even started.
 *
 * @param db - Database instance
 * @param results - One entry per distinct value per relation column
 */
export async function updateResolutionsWithLookupResults(
  db: Database,
  results: RelationLookupResult[]
): Promise<void> {
  await updateResolutionsByHash(
    db,
    results.map((result) => {
      const row = toResolutionRow(result)
      return {
        importJobPropertyId: result.jobPropertyId,
        hashedValue: result.hash,
        status: row.status,
        resolvedValues: row.resolvedValues,
        isValid: row.isValid,
        errorMessage: result.error ?? null,
      }
    })
  )
}
