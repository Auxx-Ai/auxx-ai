// packages/lib/src/seed/entity-migrations/migrations/033-external-id-field-hidden-in-dialogs.ts

import { type Database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { FieldOptions } from '../../../custom-fields'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:033')

/**
 * Migration 033: Hide legacy "External ID" fields from the default
 * create/update dialogs.
 *
 * `external_id` was a registry system field retired by #1028 — the static
 * registry entry is gone but the materialized CustomField rows survive in
 * every org. With no static counterpart, `mergeSystemAndCustomFields` can't
 * enrich them, so no registry flag can reach them; the rows themselves need
 * `options.showInDialogs: false` for the dialog default-hidden rule
 * (use-field-view.ts) to apply. External ids are written by integrations,
 * not typed by humans at create time.
 */
export const migration033ExternalIdFieldHiddenInDialogs: EntityMigration = {
  id: '033-external-id-field-hidden-in-dialogs',
  description: 'Set options.showInDialogs=false on legacy external_id CustomField rows',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const rows = await db
      .select({ id: schema.CustomField.id, options: schema.CustomField.options })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'external_id'),
          eq(schema.CustomField.type, FieldTypeEnum.TEXT)
        )
      )

    let changed = false
    for (const row of rows) {
      const currentOptions = (row.options as FieldOptions) ?? {}
      if ((currentOptions as { showInDialogs?: boolean }).showInDialogs === false) continue

      await db
        .update(schema.CustomField)
        .set({
          options: { ...currentOptions, showInDialogs: false },
          updatedAt: new Date(),
        })
        .where(eq(schema.CustomField.id, row.id))
      changed = true
    }

    if (changed) {
      logger.info('Migration 033 applied', { organizationId })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
