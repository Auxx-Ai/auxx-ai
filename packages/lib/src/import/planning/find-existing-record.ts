// packages/lib/src/import/planning/find-existing-record.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import type { Resource, ResourceField } from '../../resources'
import { lookupEntitiesByFieldValue } from '../../resources/lookup'
import { parseRecordId } from '../../resources/resource-id'
import { BaseType } from '../../workflow-engine/core/types'

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

/** Options for creating a findExistingRecord function */
export interface FindExistingRecordOptions {
  db: Database
  organizationId: string
  resource: Resource
  identifierField: ResourceField
}

/**
 * Create a function to find existing records by identifier value.
 * Dynamically queries the correct table and column based on resource definition.
 */
export function createFindExistingRecord(options: FindExistingRecordOptions) {
  const { db, organizationId, resource, identifierField } = options

  logger.info('Creating findExistingRecord function', {
    resourceId: resource.id,
    resourceType: resource.type,
    identifierKey: identifierField.key,
    identifierDbColumn: identifierField.dbColumn,
    identifierType: identifierField.type,
  })

  return async (identifierValue: string): Promise<string | null> => {
    if (!identifierValue?.trim()) {
      logger.debug('Empty identifier value, returning null')
      return null
    }

    const value = identifierValue.trim()

    // System resources - use SYSTEM_TABLE_MAP
    const table = getSystemTable(resource.id)
    if (table) {
      const result = await findInSystemTable(db, table, organizationId, identifierField, value)
      logger.debug('System table lookup', {
        resourceId: resource.id,
        identifierField: identifierField.key,
        value,
        foundId: result,
      })
      return result
    }

    // Custom entities - query via FieldValue
    if (resource.type === 'custom' && resource.entityDefinitionId) {
      const result = await findInCustomEntity(
        db,
        organizationId,
        resource.entityDefinitionId,
        identifierField,
        value
      )
      logger.debug('Custom entity lookup', {
        entityDefinitionId: resource.entityDefinitionId,
        identifierField: identifierField.key,
        value,
        foundId: result,
      })
      return result
    }

    logger.warn('No lookup method available', {
      resourceId: resource.id,
      resourceType: resource.type,
    })
    return null
  }
}

/**
 * Find a record in a system table by identifier field.
 */
async function findInSystemTable(
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  organizationId: string,
  identifierField: ResourceField,
  value: string
): Promise<string | null> {
  const columnName = identifierField.dbColumn ?? identifierField.key
  const column = table[columnName]
  if (!column) return null

  // Email compares case-insensitively; everything else (including id) is exact.
  //
  // `lower(col) = lower(value)`, NOT `ilike(col, value)`. ILIKE treats its right
  // operand as a PATTERN, and the raw CSV cell is not one: `_` matches any single
  // character and `%` any sequence. Underscores are ordinary in email local parts,
  // so `john_smith@acme.com` used to match a stored `johnXsmith@acme.com` — and
  // because this function decides create-vs-update, a false match makes the import
  // UPDATE a different person's record instead of creating a new one. `.limit(1)`
  // has no ORDER BY, so which row got clobbered was arbitrary. A wrong write, not
  // a missed one.
  //
  // Custom entities never had this bug — they route through the shared lookup core
  // (`findInCustomEntity`), which does typed column equality.
  //
  // ⚠️ NOTE (2026-08-16): no registry-shipped system resource currently REACHES this
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
  const isEmail = identifierField.type === BaseType.EMAIL
  const compareOp = isEmail ? eq(sql`lower(${column})`, value.toLowerCase()) : eq(column, value)

  const result = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, organizationId), compareOp))
    .limit(1)

  return result[0]?.id ?? null
}

/**
 * Find a record in a custom entity by identifier field value.
 *
 * Routes through the shared lookup core so the comparison mirrors write-path
 * normalization (EMAIL lowercased, URL protocol-prefixed, PHONE E.164 —
 * previously the raw CSV cell was compared against the normalized stored value
 * and could never match a `Foo@Bar.com` cell, the historic "uniqueness breaks
 * imports" root cause). Archived records are excluded — an import must never
 * resolve a row to a merged-away/archived record — and matching is
 * deterministic (entityId, sortKey ordering).
 */
async function findInCustomEntity(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  identifierField: ResourceField,
  value: string
): Promise<string | null> {
  if (!identifierField.id) return null

  const result = await lookupEntitiesByFieldValue(db, {
    organizationId,
    entityDefinitionId,
    candidates: [{ fieldId: identifierField.id, value }],
    limit: 1,
    excludeArchived: true,
  })

  if (result.isErr()) {
    // Sole candidate uncoercible (e.g. malformed email cell) — no match.
    logger.debug('Identifier value not coercible for lookup', {
      entityDefinitionId,
      identifierField: identifierField.key,
      value,
    })
    return null
  }

  const match = result.value.items[0]
  if (!match) return null
  return parseRecordId(match.recordId).entityInstanceId
}
