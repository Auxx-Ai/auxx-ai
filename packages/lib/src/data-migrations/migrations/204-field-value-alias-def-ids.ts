// packages/lib/src/data-migrations/migrations/204-field-value-alias-def-ids.ts
// Repoints FieldValue rows stamped with a bare entity type (`quote`) at their field's definition
// id — written by alias RecordIds before the write path canonicalized them.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { sql } from 'drizzle-orm'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:204')

export interface Migration204Result extends PerOrgMigrationResult {
  fieldValuesRepointed: number
}

const NOTHING: Migration204Result = {
  entityDefsCreated: 0,
  fieldsCreated: 0,
  relationshipsLinked: 0,
  alreadyUpToDate: true,
  fieldValuesRepointed: 0,
}

/**
 * Migration 204: a row is repointed only when its stored value is the `entityType` of its field's
 * definition AND that type is one the write path canonicalizes (`ENTITY_DEFINITION_TYPES`), so the
 * slug-keyed table-backed `thread`/`article` rows and anything unexplained stay put. Idempotent.
 */
export const migration204FieldValueAliasDefIds: PerOrgMigration = {
  id: '204-field-value-alias-def-ids',
  description:
    'Repoints FieldValue.entityDefinitionId from a bare entity type (written through an alias ' +
    'RecordId such as quote:<id>) to the owning CustomField definition id.',

  async up(db: Database, organizationId: string): Promise<Migration204Result> {
    const result = await db.execute(sql`
      UPDATE "FieldValue" fv
      SET "entityDefinitionId" = cf."entityDefinitionId"
      FROM "CustomField" cf
      JOIN "EntityDefinition" ed ON ed.id = cf."entityDefinitionId"
      WHERE fv."organizationId" = ${organizationId}
        AND fv."fieldId" = cf.id
        AND fv."entityDefinitionId" <> cf."entityDefinitionId"
        AND fv."entityDefinitionId" = ed."entityType"
        AND ed."entityType" IN (${sql.join(
          ENTITY_DEFINITION_TYPES.map((type) => sql`${type}`),
          sql`, `
        )})
    `)
    const repointed = result.rowCount ?? 0
    if (repointed === 0) return NOTHING

    logger.info('Migration 204 applied', { organizationId, fieldValuesRepointed: repointed })
    return { ...NOTHING, alreadyUpToDate: false, fieldValuesRepointed: repointed }
  },
}
