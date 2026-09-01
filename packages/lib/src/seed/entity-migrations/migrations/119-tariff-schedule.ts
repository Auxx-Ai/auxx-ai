// packages/lib/src/seed/entity-migrations/migrations/119-tariff-schedule.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { TARIFF_CODE_FIELDS } from '../../../resources/registry/resources/tariff-code-fields'
import { TARIFF_RATE_FIELDS } from '../../../resources/registry/resources/tariff-rate-fields'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:119')

/** The two defs this migration creates. */
const NEW_TYPES = ['tariff_code', 'tariff_rate'] as const

/** The def that receives the pointer. Created by migration 001. */
const VENDOR_PART_ENTITY_TYPE = 'vendor_part'

/**
 * The field added to the def this migration does not create, listed by REGISTRY
 * KEY rather than taken as "everything new on `VENDOR_PART_FIELDS`" - so a
 * later, unrelated field on the supplier offer cannot silently join this
 * migration's payload. Migration 109's comment gives the reason and it holds
 * here.
 *
 * 🛑 `tariffRate` is NOT in this list. It already exists on every org and
 * `ensureCustomFields` is insert-only, so re-listing it would create nothing
 * and only obscure that its DESCRIPTION change (to "override") reaches no
 * existing org. That is deliberate: the description is documentation, the
 * behaviour is the resolver's precedence rule, and rewriting live `CustomField`
 * rows to fix a help string is not worth a write across the fleet.
 */
const VENDOR_PART_FIELD_KEYS = ['tariffCode'] as const

/**
 * Migration 119: the tariff schedule
 * (plans/money/tasks/29-tariff-schedule.md §9).
 *
 * ## What it adds
 *
 * Two defs, both `isVisible` with ordinary record CRUD (§12 d):
 *
 *   tariff_code   code, country, description, + rates / vendorParts inverses
 *   tariff_rate   tariffCode, rate, effectiveFrom, authority,
 *                 chapter99Code, note
 *
 * And one field on the supplier offer:
 *
 *   vendor_part.tariffCode   belongs_to -> tariff_code, nullable
 *
 * A duty rate is a function of **(classification, origin, date)**. Today only
 * the rate itself is expressible, as `vendor_part_tariff_rate` - a hand-keyed
 * percentage with no history, so when a rate moves the old one is simply gone
 * and a receipt keyed a week later is valued wrong with nothing thrown. These
 * three fields are the other two axes.
 *
 * ## ✅ Inert on deploy, by construction
 *
 * Every existing `vendor_part` row keeps whatever `tariffRate` it has, and
 * under §3.1 a set rate is an **override** that wins outright - the schedule is
 * not consulted at all. So no stored cost changes, nothing revalues, and no
 * `part_cost` moves. The schedule only starts doing work once somebody clears
 * an override and points the offer at a code, which is an act a person
 * performs.
 *
 * The new defs are also created EMPTY. There is no seeded starter schedule:
 * rates are jurisdiction-specific, dated, and wrong within months, and shipping
 * a stale one is worse than shipping none.
 *
 * ## 🛑 `part.hsCode` is NOT seeded into `tariff_code`
 *
 * It is tempting - there are existing HTS strings sitting on parts and the
 * registry starts empty. But `tariff_code` is keyed on `(code, country)` and
 * the country half is **unknown** for every one of those strings. A registry
 * full of origin-less rows defeats the whole key: it would either need a
 * sentinel origin that no rate can honestly attach to, or one row per code that
 * the first dual-sourced part immediately contradicts. `part.hsCode` stays the
 * decorative free text it already is and can seed the code half of a picker,
 * where a person supplies the origin.
 *
 * ## Why this is ONE migration and not three
 *
 * Same argument as 108 and 109. `linkNewRelationships` links what is in the
 * FIELD MAP it is handed, not what is in the database. Split up,
 * `vendor_part.tariffCode` and `tariff_rate.tariffCode` would each be
 * materialised while their counterpart def did not exist, the linker would skip
 * them with a debug line, and a later migration would have to re-read those
 * rows purely so the linker could see them. Every counterpart is in the same
 * map before the single `linkNewRelationships` call below.
 *
 * ## No DDL
 *
 * `EntityDefinition.entityType` is a `text()` column, so two new entity types
 * are this migration plus hand-edits to `enums.ts`
 * (`ModelTypeValues` / `ModelTypes` / `ModelTypeMeta`), `field-registry.ts`,
 * `create-fields.ts`, `constants.ts` (`SYSTEM_ENTITIES` +
 * `DISPLAY_FIELD_CONFIG`), `types/resource/utils.ts` and the system-attribute
 * union. If a `.sql` file appears under `packages/database/drizzle/` for this
 * work, something is wrong.
 *
 * Idempotent: every helper is insert-only or skips existing rows, and
 * `linkNewRelationships` only writes an `inverseResourceFieldId` that is null.
 */
export const migration119TariffSchedule: EntityMigration = {
  id: '119-tariff-schedule',
  description:
    'Add the tariff_code and tariff_rate entities and the vendor_part tariffCode pointer - ' +
    'the dated duty schedule behind the supplier offer',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // `vendor_part` is the hard dependency: it is what carries the pointer and
    // it is seeded by migration 001. An org that has not reached 001 is skipped
    // rather than failed - 001 seeds the full registry, so it picks the pointer
    // up itself, and a later run of this migration adds the two defs.
    const vendorPartDef = existing.entityDefs.get(VENDOR_PART_ENTITY_TYPE)
    if (!vendorPartDef) return { ...state, alreadyUpToDate: true }

    // ── Step 1: the two EntityDefinitions ──────────────────────────────
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )

    // Pull the incumbent def into the id map so `linkNewRelationships` can
    // resolve BOTH directions of every pair in the single pass below.
    entityDefIds.set(VENDOR_PART_ENTITY_TYPE, vendorPartDef.id)

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    const merge = (m: typeof allFieldMaps) => {
      for (const [k, v] of m) allFieldMaps.set(k, v)
    }

    // ── Step 2: the two full registries ────────────────────────────────
    const newRegistries: Record<(typeof NEW_TYPES)[number], Record<string, ResourceField>> = {
      tariff_code: TARIFF_CODE_FIELDS,
      tariff_rate: TARIFF_RATE_FIELDS,
    }

    for (const entityType of NEW_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          entityType,
          defId,
          newRegistries[entityType],
          existing,
          state
        )
      )
    }

    // ── Step 3: the pointer on the supplier offer ──────────────────────
    const vendorPartFields: Record<string, ResourceField> = {}
    for (const key of VENDOR_PART_FIELD_KEYS) {
      const field = VENDOR_PART_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make
      // this migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`vendor_part registry is missing the key "${key}" (migration 119)`)
      }
      vendorPartFields[key] = field
    }
    merge(
      await ensureCustomFields(
        db,
        organizationId,
        VENDOR_PART_ENTITY_TYPE,
        vendorPartDef.id,
        vendorPartFields,
        existing,
        state
      )
    )

    // ── Step 4: link relationships and display fields ──────────────────
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, [...NEW_TYPES], entityDefIds, allFieldMaps)

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    // New definitions and fields are invisible to every read path until the
    // per-org caches that serve them are dropped. `runEntityMigrationsForOrg`
    // does this after the whole batch, but `up()` can also be invoked directly,
    // so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 119 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
