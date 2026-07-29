// packages/lib/src/seed/entity-migrations/migrations/057-remove-signature-visibility-field.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { onCacheEvent } from '../../../cache'
import { updateUserSetting } from '../../../settings'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:057')

/**
 * The two `SIGNATURE_FIELDS` entries removed from the registry by plan 36.
 *
 * - `signature_visibility` — replaced by `ResourceAccess` rows (plan 36 §0.3);
 *   migration `056` converted every value into grants before this runs.
 * - `signature_is_default` — "default signature" becomes per-USER, stored in
 *   `UserSetting` under `signature.defaultId` (plan 36 §12.2). An org-global
 *   default is incoherent once signatures are private by default: it can point
 *   at a signature most members cannot see.
 */
const REMOVED_ATTRS = ['signature_visibility', 'signature_is_default'] as const

/** The `UserSetting` key the per-user default lands on (`settings/catalog.ts`). */
const DEFAULT_SETTING_KEY = 'signature.defaultId'

/** One `signature_is_default = true` signature, with its owner resolved. */
export interface DefaultSignatureSeed {
  signatureId: string
  /** `null` when no real `User.id` could be resolved — never written. */
  ownerId: string | null
}

export interface PreservedDefaults {
  /** One `UserSetting` write per owner: `signature.defaultId` → `signatureId`. */
  writes: { userId: string; signatureId: string }[]
  /** Defaults whose owner did not resolve to a real `User.id`. */
  skipped: DefaultSignatureSeed[]
  /**
   * Extra defaults belonging to an owner who already has one. The org-global
   * field allowed several rows to be `true` at once (nothing enforced a single
   * default), but the per-user pointer holds exactly one id.
   */
  duplicates: DefaultSignatureSeed[]
}

/**
 * Fold the org-global `signature_is_default` flags into per-user pointers.
 *
 * Pure and deterministic — the caller's row order decides which of an owner's
 * several defaults wins, and the losers are REPORTED rather than silently
 * overwritten, so "this member had three defaults" is findable in the log
 * instead of resolved by whichever row the planner happened to return last.
 *
 * An owner-less seed is skipped: `UserSetting.userId` is a real FK, so writing a
 * fabricated id would abort the migration.
 */
export function buildDefaultSignatureSettings(
  seeds: readonly DefaultSignatureSeed[]
): PreservedDefaults {
  const writes: { userId: string; signatureId: string }[] = []
  const skipped: DefaultSignatureSeed[] = []
  const duplicates: DefaultSignatureSeed[] = []
  const claimed = new Set<string>()

  for (const seed of seeds) {
    if (!seed.ownerId) {
      skipped.push(seed)
      continue
    }
    if (claimed.has(seed.ownerId)) {
      duplicates.push(seed)
      continue
    }
    claimed.add(seed.ownerId)
    writes.push({ userId: seed.ownerId, signatureId: seed.signatureId })
  }

  return { writes, skipped, duplicates }
}

/**
 * Resolve each signature's owner to a verified `User.id`.
 *
 * The same two-step migration `056` uses, deliberately reimplemented here rather
 * than imported: a migration is a snapshot and must not break when a sibling
 * migration is edited (`feedback_migrations_self_sufficient`).
 *
 *  1. `EntityInstance.createdById` — the real column, an FK to `User`.
 *  2. the `created_by_id` `FieldValue`'s `actorId`. Per
 *     `project_actor_fieldvalue_storage_routing` an ACTOR value only stores a
 *     `User.id` in `actorId`; non-user actor kinds route through
 *     `relatedEntityId`, so a row carrying `relatedEntityId` but no `actorId` is
 *     NOT a user and must not be treated as one.
 *
 * Everything is then verified against the `User` table, because
 * `UserSetting.userId` is a real FK.
 */
async function resolveSignatureOwners(
  db: Database,
  organizationId: string,
  signatureIds: string[]
): Promise<Map<string, string>> {
  const owners = new Map<string, string>()
  if (signatureIds.length === 0) return owners

  const instances = await db
    .select({
      id: schema.EntityInstance.id,
      createdById: schema.EntityInstance.createdById,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, signatureIds),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )

  const actorValues = await db
    .select({
      entityId: schema.FieldValue.entityId,
      actorId: schema.FieldValue.actorId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        inArray(schema.FieldValue.entityId, signatureIds),
        eq(schema.CustomField.systemAttribute, 'created_by_id')
      )
    )

  const actorOwner = new Map<string, string>()
  for (const row of actorValues) {
    if (row.actorId) actorOwner.set(row.entityId, row.actorId)
  }

  const candidates = new Map<string, string>()
  for (const instance of instances) {
    const ownerId = instance.createdById ?? actorOwner.get(instance.id)
    if (ownerId) candidates.set(instance.id, ownerId)
  }

  const candidateIds = [...new Set(candidates.values())]
  if (candidateIds.length === 0) return owners

  const realUsers = await db
    .select({ id: schema.User.id })
    .from(schema.User)
    .where(inArray(schema.User.id, candidateIds))
  const realUserIds = new Set(realUsers.map((u) => u.id))

  for (const [signatureId, ownerId] of candidates) {
    if (realUserIds.has(ownerId)) owners.set(signatureId, ownerId)
  }
  return owners
}

/**
 * Remove `SIGNATURE_FIELDS.visibility` and `SIGNATURE_FIELDS.isDefault` from an
 * org's materialized `CustomField` rows, along with their `FieldValue` cells —
 * carrying each org-global default over to its owner's `UserSetting` first.
 *
 * The inverse of the `ensureCustomFields` add path: per
 * `project_registry_fields_need_materialization` a registry field only exists
 * for an org once it is materialized, so removing it from the registry is only
 * half the change — the per-org rows have to go too, or every form, filter and
 * builder keeps offering a field the registry no longer describes. Cache
 * invalidation is handled by the runner: `runEntityMigrationForAllOrgs`
 * recomputes `entityDefs` / `entityDefSlugs` / `customFields` / `resources` for
 * any org whose result is not `alreadyUpToDate`.
 *
 * **Ordering.** Must run after `056-signatures-snippets-instance-access`, which
 * READS `signature_visibility`. The runner walks the registry in id order with
 * fail-stop (`plan.ts`), and `056 < 057`, so that holds by construction.
 *
 * **What happens to the old defaults.** Each signature flagged
 * `signature_is_default = true` writes its RESOLVED OWNER's
 * `signature.defaultId` `UserSetting`. That keeps the one member who actually
 * owns the signature pointed at it and drops the org-global fan-out plan 36
 * §12.2 exists to kill — under `baselineAtCreate: true` the other members could
 * not see that signature anyway, so inheriting the pointer would only hand the
 * composer an id it will 403 on. The write goes through `updateUserSetting`
 * rather than a raw insert so the value is normalized by the same catalog entry
 * `signature.getDefault` reads it back through. Defaults whose owner cannot be
 * resolved, and an owner's second and later defaults, are logged rather than
 * guessed at.
 *
 * Idempotent — a re-run finds no matching `CustomField` rows and reports
 * `alreadyUpToDate`. The `UserSetting` writes are upserts on
 * (userId, organizationId, key), so a repeat pass over the same data converges.
 */
export const migration057RemoveSignatureVisibilityField: EntityMigration = {
  id: '057-remove-signature-visibility-field',
  description:
    'Remove the retired signature_visibility + signature_is_default fields, preserving each org-global default as its owner’s per-user UserSetting',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const signatureDef = existing.entityDefs.get('signature')
    if (!signatureDef) {
      return { ...state, alreadyUpToDate: true }
    }

    const fields = await db
      .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, signatureDef.id),
          inArray(schema.CustomField.systemAttribute, [...REMOVED_ATTRS])
        )
      )

    if (fields.length === 0) {
      return { ...state, alreadyUpToDate: true }
    }

    const fieldIds = fields.map((f) => f.id)
    const defaultFieldIds = fields
      .filter((f) => f.systemAttribute === 'signature_is_default')
      .map((f) => f.id)

    // Carry the org-global defaults over to their owners BEFORE the delete.
    if (defaultFieldIds.length > 0) {
      const flagged = await db
        .select({
          entityId: schema.FieldValue.entityId,
          valueBoolean: schema.FieldValue.valueBoolean,
        })
        .from(schema.FieldValue)
        .where(inArray(schema.FieldValue.fieldId, defaultFieldIds))

      // Sorted so which of an owner's several defaults wins is deterministic
      // across runs and environments, rather than planner-dependent.
      const defaultIds = flagged
        .filter((row) => row.valueBoolean === true)
        .map((row) => row.entityId)
        .sort()

      const owners = await resolveSignatureOwners(db, organizationId, defaultIds)
      const { writes, skipped, duplicates } = buildDefaultSignatureSettings(
        defaultIds.map((signatureId) => ({ signatureId, ownerId: owners.get(signatureId) ?? null }))
      )

      for (const write of writes) {
        await updateUserSetting({
          userId: write.userId,
          organizationId,
          key: DEFAULT_SETTING_KEY,
          value: write.signatureId,
          db,
        })
        // `signature.getDefault` reads through the `userSettings` user-cache
        // blob, so an unflushed member keeps returning `null` for a default the
        // migration just restored.
        await onCacheEvent('user.settings.changed', {
          orgId: organizationId,
          userId: write.userId,
        })
      }
      for (const row of skipped) {
        logger.warn('Default signature owner unresolvable — per-user default not written', {
          organizationId,
          signatureId: row.signatureId,
        })
      }
      for (const row of duplicates) {
        logger.warn('Owner already has a default signature — extra org-global default dropped', {
          organizationId,
          signatureId: row.signatureId,
          userId: row.ownerId,
        })
      }
      if (writes.length > 0 || skipped.length > 0 || duplicates.length > 0) {
        logger.info('Preserved org-global default signatures as per-user settings', {
          organizationId,
          preserved: writes.length,
          skipped: skipped.length,
          duplicates: duplicates.length,
        })
      }
    }

    const deletedValues = await db
      .delete(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, fieldIds))
      .returning({ id: schema.FieldValue.id })

    await db.delete(schema.CustomField).where(inArray(schema.CustomField.id, fieldIds))

    logger.info('Migration 057 applied', {
      organizationId,
      fieldsRemoved: fieldIds.length,
      valuesRemoved: deletedValues.length,
    })

    return { ...state, alreadyUpToDate: false }
  },
}
