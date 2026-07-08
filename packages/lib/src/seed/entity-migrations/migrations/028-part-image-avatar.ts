// packages/lib/src/seed/entity-migrations/migrations/028-part-image-avatar.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { FieldOptions } from '../../../custom-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:028')

/**
 * The image-only single-file config that the part avatar picker expects,
 * mirroring the contact avatar field. Kept in sync with `PART_FIELDS.image`.
 */
const PART_IMAGE_FILE_OPTIONS = {
  allowMultiple: false,
  maxFiles: 1,
  allowedFileTypes: ['image'],
} as const

/**
 * Migration 028: Part image avatar
 *
 * Orgs created before `part_image` was added to the registry never got the
 * CustomField seeded (migration 007 only *links* `avatarFieldId` when the field
 * already exists — it never *creates* it), so their part records fall back to
 * the icon. This migration:
 *
 * 1. Ensures the `part_image` CustomField exists (creates it with the correct
 *    image-only file options for orgs missing it).
 * 2. Normalizes `options.file` on pre-existing fields to `{ allowMultiple:
 *    false, maxFiles: 1, allowedFileTypes: ['image'] }` (older rows only had
 *    `{ maxFiles: 1, allowMultiple: false }`, so any file was accepted).
 * 3. Links `EntityDefinition.avatarFieldId` to the field when unset.
 */
export const migration028PartImageAvatar: EntityMigration = {
  id: '028-part-image-avatar',
  description:
    'Ensure part_image CustomField (image-only file options) exists and link part avatarFieldId',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    let changed = false

    const existing = await loadExistingState(db, organizationId)
    const partDef = existing.entityDefs.get('part')
    if (!partDef) return { ...state, alreadyUpToDate: true }

    // ── Step 1: Ensure the part_image CustomField exists ──
    // Creates it (with the registry's image-only file options) when missing;
    // returns the existing field otherwise.
    const fieldMap = await ensureCustomFields(
      db,
      organizationId,
      'part',
      partDef.id,
      { image: PART_FIELDS.image! },
      existing,
      state
    )
    const imageField = fieldMap.get(`part:${PART_FIELDS.image!.id}`)
    if (!imageField) return { ...state, alreadyUpToDate: state.fieldsCreated === 0 }

    // ── Step 2: Normalize options.file on pre-existing fields ──
    // Compared field-by-field because jsonb does not preserve key order, so a
    // JSON.stringify diff would report a spurious change on every re-run.
    const currentOptions = (imageField.options as FieldOptions) ?? {}
    const currentFile = (currentOptions as { file?: Record<string, unknown> }).file
    const fileUpToDate =
      currentFile?.allowMultiple === false &&
      currentFile?.maxFiles === 1 &&
      Array.isArray(currentFile?.allowedFileTypes) &&
      currentFile.allowedFileTypes.length === 1 &&
      currentFile.allowedFileTypes[0] === 'image'

    if (!fileUpToDate) {
      await db
        .update(schema.CustomField)
        .set({
          options: { ...currentOptions, file: { ...PART_IMAGE_FILE_OPTIONS } },
          updatedAt: new Date(),
        })
        .where(eq(schema.CustomField.id, imageField.id))
      changed = true
    }

    // ── Step 3: Link avatarFieldId on the part EntityDefinition (if unset) ──
    const linked = await db
      .update(schema.EntityDefinition)
      .set({ avatarFieldId: imageField.id, updatedAt: new Date() })
      .where(
        and(
          eq(schema.EntityDefinition.id, partDef.id),
          isNull(schema.EntityDefinition.avatarFieldId)
        )
      )
      .returning({ id: schema.EntityDefinition.id })
    if (linked.length > 0) {
      state.relationshipsLinked++
      changed = true
    }

    const alreadyUpToDate = !changed && state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 028 applied', { organizationId, ...state })
    }
    return { ...state, alreadyUpToDate }
  },
}
