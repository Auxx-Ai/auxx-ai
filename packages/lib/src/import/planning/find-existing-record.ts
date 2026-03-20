// packages/lib/src/import/planning/find-existing-record.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getValueType } from '@auxx/types'
import { and, eq, ilike } from 'drizzle-orm'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import type { Resource, ResourceField } from '../../resources'
import { BaseType } from '../../workflow-engine/core/types'

const logger = createScopedLogger('find-existing-record')

/**
 * Map of system resource IDs to their Drizzle table definitions.
 * Used for querying system tables during import planning.
 */
// Contact and Ticket tables have been dropped - they now use EntityInstance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SYSTEM_TABLE_MAP: Record<string, PgTableWithColumns<any>> = {
  thread: schema.Thread,
  user: schema.User,
  inbox: schema.Inbox,
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
        resource.entityDefinitionId,
        organizationId,
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

  // Use ilike only for email fields (case-insensitive), eq for everything else (including id)
  const isEmail = identifierField.type === BaseType.EMAIL
  const compareOp = isEmail ? ilike(column, value) : eq(column, value)

  const result = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, organizationId), compareOp))
    .limit(1)

  return result[0]?.id ?? null
}

/**
 * Find a record in a custom entity by unique field value.
 * Queries FieldValue table using typed columns to find the entityId.
 */
async function findInCustomEntity(
  db: Database,
  entityDefinitionId: string,
  organizationId: string,
  identifierField: ResourceField,
  value: string
): Promise<string | null> {
  if (!identifierField.id) return null

  // Determine which typed column to query based on field type
  const dbFieldType = identifierField.fieldType || 'TEXT'
  const valueType = getValueType(dbFieldType)

  // Build the value comparison based on type
  let valueComparison
  switch (valueType) {
    case 'text':
      valueComparison = eq(schema.FieldValue.valueText, value)
      break
    case 'number':
      valueComparison = eq(schema.FieldValue.valueNumber, parseFloat(value))
      break
    case 'option':
      valueComparison = eq(schema.FieldValue.optionId, value)
      break
    default:
      // For other types, use text column
      valueComparison = eq(schema.FieldValue.valueText, value)
  }

  const result = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.FieldValue.entityId, schema.EntityInstance.id))
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, identifierField.id),
        valueComparison
      )
    )
    .limit(1)

  return result[0]?.entityId ?? null
}
