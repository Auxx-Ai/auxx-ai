// packages/lib/src/seed/entity-migrations/migrations/120-tariff-code-label.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { composeTariffCodeLabel } from '../../../bom/vendor-cost'
import { getOrgCache } from '../../../cache'
import { notifyEntityDefChanged } from '../../../entity-definitions/notify'
import { DisplayFieldService } from '../../../field-values/display-field-service'
import type { ResourceField } from '../../../resources/registry/field-types'
import { TARIFF_CODE_FIELDS } from '../../../resources/registry/resources/tariff-code-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:120')

const TARIFF_CODE_ENTITY_TYPE = 'tariff_code'
const TARIFF_RATE_ENTITY_TYPE = 'tariff_rate'

const CODE_ATTR = 'tariff_code_code'
const COUNTRY_ATTR = 'tariff_code_country'
const LABEL_ATTR = 'tariff_code_label'
const DESCRIPTION_ATTR = 'tariff_code_description'

/**
 * The one field this migration adds, by REGISTRY KEY (migration 119's rule):
 * a later field on `tariff_code` cannot silently join this payload.
 */
const NEW_FIELD_KEYS = ['label'] as const

/**
 * Migration 120: the derived `tariff_code_label`
 * (plans/money/tasks/30-tariff-offer-surfaces.md §8).
 *
 * ## Why
 *
 * A relation column on import matches ONE field, and `tariff_code`'s identity is
 * TWO. With `code` as the display field the supplier-price importer resolved
 * `8481.80.9005` to the CN and DE records interchangeably and reported success,
 * pointing half the Chinese offers at the German classification. The rate
 * importer (29 §12 e) had no way to name its code at all.
 *
 * `label` is `{code} {country}`, stamped by `field-hooks/pre/tariff-code-label.ts`
 * on create and on every edit to either leg, `creatable: false` /
 * `updatable: false`, and becomes the PRIMARY DISPLAY FIELD - so `displayName`
 * reads `8481.80.9005 CN` everywhere and both importers match on it exactly.
 *
 * ## Three steps, each idempotent
 *
 * 1. `ensureCustomFields` for `label` (insert-only).
 * 2. Backfill: one `FieldValue` per existing code that has none, composed from
 *    its `code` (valueText) and `country` (optionId). Rows that already carry a
 *    label are left alone - the hook owns them from here.
 * 3. Repoint display: primary `code` -> `label`, secondary `country` ->
 *    `description`, then recompute every code's `displayName` AND every rate's,
 *    because a rate's display is projected from its code. Skipped when an org
 *    has customised the pointer, following 115.
 *
 * MUST sort after 119, which creates the def and both legs.
 */
export const migration120TariffCodeLabel: EntityMigration = {
  id: '120-tariff-code-label',
  description:
    'Add the derived tariff_code label ({code} {country}), backfill it, and make it the display field',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const codeDef = existing.entityDefs.get(TARIFF_CODE_ENTITY_TYPE)
    if (!codeDef) return { ...state, alreadyUpToDate: true }

    const codeField = existing.fields.get(fieldKey(codeDef.id, CODE_ATTR))
    const countryField = existing.fields.get(fieldKey(codeDef.id, COUNTRY_ATTR))
    const descriptionField = existing.fields.get(fieldKey(codeDef.id, DESCRIPTION_ATTR))
    if (!codeField || !countryField || !descriptionField) {
      return { ...state, alreadyUpToDate: true }
    }

    // ── Step 1: the field ──────────────────────────────────────────────
    const newFields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = TARIFF_CODE_FIELDS[key]
      if (!field) {
        throw new Error(`tariff_code registry is missing the key "${key}" (migration 120)`)
      }
      newFields[key] = field
    }
    const created = await ensureCustomFields(
      db,
      organizationId,
      TARIFF_CODE_ENTITY_TYPE,
      codeDef.id,
      newFields,
      existing,
      state
    )
    const labelFieldId =
      created.get(`${TARIFF_CODE_ENTITY_TYPE}:label`)?.id ??
      existing.fields.get(fieldKey(codeDef.id, LABEL_ATTR))?.id
    if (!labelFieldId) throw new Error('migration 120 could not resolve tariff_code_label')

    // ── Step 2: backfill ───────────────────────────────────────────────
    const backfilled = await backfillLabels(db, organizationId, {
      entityDefinitionId: codeDef.id,
      codeFieldId: codeField.id,
      countryFieldId: countryField.id,
      labelFieldId,
    })

    // ── Step 3: display pointer ────────────────────────────────────────
    const [pointers] = await db
      .select({
        primaryDisplayFieldId: schema.EntityDefinition.primaryDisplayFieldId,
        secondaryDisplayFieldId: schema.EntityDefinition.secondaryDisplayFieldId,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.id, codeDef.id))

    let repointed = false
    if (pointers?.primaryDisplayFieldId === codeField.id) {
      await db
        .update(schema.EntityDefinition)
        .set({
          primaryDisplayFieldId: labelFieldId,
          secondaryDisplayFieldId: descriptionField.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.EntityDefinition.id, codeDef.id))
      repointed = true
    } else if (pointers?.primaryDisplayFieldId !== labelFieldId) {
      logger.debug('Migration 120 left a customised display pointer alone', {
        organizationId,
        primaryDisplayFieldId: pointers?.primaryDisplayFieldId ?? null,
      })
    }

    const changed = state.fieldsCreated > 0 || backfilled > 0 || repointed
    if (!changed) return { ...state, alreadyUpToDate: true }

    // New field and pointer are invisible to every read path until the per-org
    // caches are dropped - and `recalculateDisplayFields` READS the pointer
    // through that cache, so the bust must come first (115's load-bearing
    // ordering). `notifyEntityDefChanged` also publishes `resourceDefChanged`.
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    await notifyEntityDefChanged(organizationId, codeDef.id, 'updated')

    const display = new DisplayFieldService(organizationId, db)
    await display.recalculateDisplayFields(codeDef.id, ['primary', 'secondary'])
    const rateDef = existing.entityDefs.get(TARIFF_RATE_ENTITY_TYPE)
    if (rateDef) await display.recalculateDisplayFields(rateDef.id, ['primary'])

    logger.info('Migration 120 applied', { organizationId, ...state, backfilled, repointed })
    return { ...state, alreadyUpToDate: false }
  },
}

/**
 * One `tariff_code_label` value per live code that has none. Returns how many
 * were written. Codes with no `code` value (impossible under the registry, but
 * a half-written row from before the pre-create guard could exist) are skipped
 * rather than given an empty label.
 */
async function backfillLabels(
  db: Database,
  organizationId: string,
  ids: {
    entityDefinitionId: string
    codeFieldId: string
    countryFieldId: string
    labelFieldId: string
  }
): Promise<number> {
  const rows = await db
    .select({
      instanceId: schema.EntityInstance.id,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.EntityInstance.id),
        eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ids.entityDefinitionId),
        isNull(schema.EntityInstance.archivedAt),
        inArray(schema.FieldValue.fieldId, [ids.codeFieldId, ids.countryFieldId, ids.labelFieldId])
      )
    )

  const byInstance = new Map<
    string,
    { code: string | null; country: string | null; hasLabel: boolean }
  >()
  for (const row of rows) {
    const entry = byInstance.get(row.instanceId) ?? { code: null, country: null, hasLabel: false }
    if (row.fieldId === ids.codeFieldId) entry.code = row.valueText
    else if (row.fieldId === ids.countryFieldId) entry.country = row.optionId
    else if (row.fieldId === ids.labelFieldId) entry.hasLabel = true
    byInstance.set(row.instanceId, entry)
  }

  const now = new Date()
  const inserts = [...byInstance.entries()]
    .filter(([, entry]) => !entry.hasLabel && !!entry.code)
    .map(([instanceId, entry]) => ({
      organizationId,
      entityId: instanceId,
      entityDefinitionId: ids.entityDefinitionId,
      fieldId: ids.labelFieldId,
      sortKey: generateKeyBetween(null, null),
      valueText: composeTariffCodeLabel(entry.code as string, entry.country),
      updatedAt: now,
    }))
  if (inserts.length === 0) return 0

  await db.insert(schema.FieldValue).values(inserts)
  return inserts.length
}
