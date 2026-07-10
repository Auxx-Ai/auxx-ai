// packages/lib/src/seed/entity-migrations/migrations/031-documents-field-hidden-in-dialogs.ts

import { type Database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { FieldOptions } from '../../../custom-fields'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:031')

/**
 * Migration 031: Hide template-provisioned "Documents" fields from the default
 * create/update dialogs.
 *
 * The `deal`, `complaint`, `project`, and `wholesale-order` entity templates
 * define a `templateFieldId: "documents"` FILE field (installer stamps
 * `systemAttribute: 'documents'` — see template-installer.ts `createField`).
 * As of this migration, new installs set `options.showInDialogs: false` on
 * that field directly (see the template JSONs) so it defaults to hidden in
 * `dialog_create`/`dialog_edit` contexts (see use-field-view.ts) — it's a
 * noisy multi-file upload, not something worth prompting for on every create.
 *
 * Orgs that installed one of these templates before this change have the
 * CustomField row without the flag. This migration finds every FILE field
 * with `systemAttribute = 'documents'` for the org and merges
 * `showInDialogs: false` into its `options` JSONB — matching by
 * systemAttribute rather than name, since these fields are template-owned
 * (isConfigurable = false; users can't rename them) and `templateFieldId`
 * itself isn't a CustomField column.
 */
export const migration031DocumentsFieldHiddenInDialogs: EntityMigration = {
  id: '031-documents-field-hidden-in-dialogs',
  description: 'Set options.showInDialogs=false on template-provisioned Documents FILE fields',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const rows = await db
      .select({ id: schema.CustomField.id, options: schema.CustomField.options })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'documents'),
          eq(schema.CustomField.type, FieldTypeEnum.FILE)
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
      logger.info('Migration 031 applied', { organizationId })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
