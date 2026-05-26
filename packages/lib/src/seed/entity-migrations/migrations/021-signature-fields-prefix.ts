// packages/lib/src/seed/entity-migrations/migrations/021-signature-fields-prefix.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq } from 'drizzle-orm'
import { SIGNATURE_FIELDS } from '../../../resources/registry/resources/signature-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:021')

/**
 * Rename the four signature-specific systemAttributes onto a `signature_` prefix
 * so they match the convention used by inbox/tag/article/etc. Also creates the
 * fields for orgs whose signature EntityDefinition was seeded before these
 * fields existed (the 3 known orgs that only have `created_by_id`).
 *
 * Rename pairs:
 *   name        → signature_name
 *   body        → signature_body
 *   is_default  → signature_is_default
 *   visibility  → signature_visibility
 *
 * Shared fields (`created_by_id`, `created_at`, `id`) stay untouched.
 */
const RENAMES = [
  { old: 'name', next: 'signature_name' },
  { old: 'body', next: 'signature_body' },
  { old: 'is_default', next: 'signature_is_default' },
  { old: 'visibility', next: 'signature_visibility' },
] as const

export const migration021SignatureFieldsPrefix: EntityMigration = {
  id: '021-signature-fields-prefix',
  description:
    'Prefix signature field systemAttributes with `signature_` and backfill missing ones',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const signatureDef = existing.entityDefs.get('signature')
    if (!signatureDef) {
      return { ...state, alreadyUpToDate: true }
    }

    const now = new Date()
    let renamed = 0

    for (const { old, next } of RENAMES) {
      const updated = await db
        .update(schema.CustomField)
        .set({ systemAttribute: next as SystemAttribute, updatedAt: now })
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.entityDefinitionId, signatureDef.id),
            eq(schema.CustomField.systemAttribute, old)
          )
        )
        .returning({ id: schema.CustomField.id })

      renamed += updated.length
    }

    // Reload state so ensureCustomFields sees the renamed rows and only creates
    // what's still missing (the 3 orgs that never had these fields at all).
    const refreshed = await loadExistingState(db, organizationId)

    await ensureCustomFields(
      db,
      organizationId,
      'signature',
      signatureDef.id,
      {
        name: SIGNATURE_FIELDS.name!,
        body: SIGNATURE_FIELDS.body!,
        isDefault: SIGNATURE_FIELDS.isDefault!,
        visibility: SIGNATURE_FIELDS.visibility!,
      },
      refreshed,
      state
    )

    const alreadyUpToDate = renamed === 0 && state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 021 applied', {
        organizationId,
        renamed,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
