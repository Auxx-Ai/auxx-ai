// packages/lib/src/data-migrations/migrations/190-parts-and-services.ts
// see plans/accounting/tasks/107-parts-and-services.md and 106-a-parts-cost-at-onboarding.md

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { deleteEntityDefinitionDeep } from '../../entity-definitions/delete-entity-definition'
import { PartKind } from '../../resources/registry/enum-values'
import type { ResourceField } from '../../resources/registry/field-types'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:190')

const PART = 'part'

/** Held as literals: these are the values matched on, not whatever the registry says later. */
const OLD_LABELS = { singular: 'Part', plural: 'Parts' } as const
const NEW_LABELS = { singular: 'Item', plural: 'Parts & Services' } as const

/** The part is the sell-side register (107 D3, D5). */
const SELLING_KEYS = ['sellable', 'sellPrice', 'markup', 'taxable'] as const
/** A channel's unit cost seeds the first standard; the origin records which door wrote it (106 D5, D9). */
const COST_KEYS = ['channelCost', 'standardCostOrigin'] as const

/** The catalog_item relationship sides that live on surviving defs (`line_item`, `part`). */
const PARTNER_ATTRIBUTES = ['line_item_catalog_item', 'part_catalog_items'] as const

const CACHE_KEYS = ['customFields', 'resources', 'entityDefs', 'entityDefSlugs'] as const

type State = Omit<PerOrgMigrationResult, 'alreadyUpToDate'>
type ExistingState = Awaited<ReturnType<typeof loadExistingState>>

interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/** `stored` with the `service` option appended, or `null` when it is already there. Pure. */
export function withServiceOption(stored: readonly StoredOption[]): StoredOption[] | null {
  if (stored.some((option) => option.value === PartKind.SERVICE)) return null
  const service = PartKind.values.find((option) => option.value === PartKind.SERVICE)
  if (!service) throw new Error('registry is missing part_kind.service')
  return [...stored, { ...service }]
}

/** The label patch for a part def, or `null`. A label an org renamed itself is kept. */
export function partLabelPatch(current: {
  singular: string
  plural: string
}): Partial<Record<'singular' | 'plural', string>> | null {
  const patch: Partial<Record<'singular' | 'plural', string>> = {}
  if (current.singular === OLD_LABELS.singular) patch.singular = NEW_LABELS.singular
  if (current.plural === OLD_LABELS.plural) patch.plural = NEW_LABELS.plural
  return Object.keys(patch).length > 0 ? patch : null
}

/** (a) Relabel the part def and append `part_kind`'s `service` option (107 D1, D2). */
async function relabelPartAndAddService(
  db: Database,
  organizationId: string,
  partDefId: string,
  existing: ExistingState
): Promise<{ labelsRenamed: boolean; serviceOptionAdded: boolean }> {
  const [def] = await db
    .select({
      id: schema.EntityDefinition.id,
      singular: schema.EntityDefinition.singular,
      plural: schema.EntityDefinition.plural,
    })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.id, partDefId)
      )
    )
    .limit(1)

  let labelsRenamed = false
  const patch = def ? partLabelPatch(def) : null
  if (patch) {
    await db
      .update(schema.EntityDefinition)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(schema.EntityDefinition.id, partDefId),
          eq(schema.EntityDefinition.organizationId, organizationId)
        )
      )
    labelsRenamed = true
  }

  // `ensureCustomFields` never rewrites an existing field's options, so the option is appended here.
  let serviceOptionAdded = false
  const kindField = existing.fields.get(fieldKey(partDefId, 'part_kind'))
  const stored = (kindField?.options as { options?: StoredOption[] } | null)?.options
  if (kindField && Array.isArray(stored)) {
    const next = withServiceOption(stored)
    if (next) {
      await db
        .update(schema.CustomField)
        .set({
          options: { ...(kindField.options as Record<string, unknown>), options: next },
          updatedAt: new Date(),
        })
        .where(eq(schema.CustomField.id, kindField.id))
      serviceOptionAdded = true
    }
  }

  return { labelsRenamed, serviceOptionAdded }
}

/** Ensures the named `PART_FIELDS` exist on the part def. No backfill. */
async function ensurePartFields(
  db: Database,
  organizationId: string,
  partDefId: string,
  keys: readonly string[],
  existing: ExistingState,
  state: State
): Promise<void> {
  const fields: Record<string, ResourceField> = {}
  for (const key of keys) {
    const field = PART_FIELDS[key]
    if (!field) throw new Error(`The part registry is missing ${key} (migration 190)`)
    fields[key] = field
  }
  await ensureCustomFields(db, organizationId, PART, partDefId, fields, existing, state)
}

/** (b) The part's own selling fields (107 D3, D5). */
const addSellingFields = (
  db: Database,
  organizationId: string,
  partDefId: string,
  existing: ExistingState,
  state: State
) => ensurePartFields(db, organizationId, partDefId, SELLING_KEYS, existing, state)

/** (c) `part_channel_cost` and `part_standard_cost_origin` (106 D5, D9). */
const addCostFields = (
  db: Database,
  organizationId: string,
  partDefId: string,
  existing: ExistingState,
  state: State
) => ensurePartFields(db, organizationId, partDefId, COST_KEYS, existing, state)

/**
 * (d) Delete the `catalog_item` def (107 D1, F5). Partner fields go first by `systemAttribute`,
 * since a system field's stored inverse id is not reliably a `CustomField.id`. Group entries
 * still holding `catalogItemId` are dropped (read back as `[]`) so the group itself survives.
 */
async function removeCatalogItem(
  db: Database,
  organizationId: string
): Promise<{
  partnerFieldsRemoved: number
  catalogItemDefDeleted: boolean
  groupEntriesCleared: number
}> {
  const removedPartners = await db
    .delete(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, [...PARTNER_ATTRIBUTES])
      )
    )
    .returning({ id: schema.CustomField.id })

  const [catalogDef] = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'catalog_item')
      )
    )
    .limit(1)
  if (catalogDef) {
    // Cascades fields, values, instances, identities, connector rows, and the text-keyed sweeps.
    await deleteEntityDefinitionDeep({
      id: catalogDef.id,
      organizationId,
      db,
      allowSystemEntity: true,
    })
  }

  const clearedEntries = await db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(
          schema.FieldValue.fieldId,
          db
            .select({ id: schema.CustomField.id })
            .from(schema.CustomField)
            .where(
              and(
                eq(schema.CustomField.organizationId, organizationId),
                eq(schema.CustomField.systemAttribute, 'catalog_group_entries')
              )
            )
        ),
        sql`${schema.FieldValue.valueJson}::text LIKE '%"catalogItemId"%'`
      )
    )
    .returning({ id: schema.FieldValue.id })

  return {
    partnerFieldsRemoved: removedPartners.length,
    catalogItemDefDeleted: !!catalogDef,
    groupEntriesCleared: clearedEntries.length,
  }
}

export interface Migration190Result extends PerOrgMigrationResult {
  labelsRenamed: boolean
  serviceOptionAdded: boolean
  partnerFieldsRemoved: number
  catalogItemDefDeleted: boolean
  groupEntriesCleared: number
}

/** Migration 190: the part becomes "Parts & Services" and the one register. Every step compares before writing. */
export const migration190PartsAndServices: PerOrgMigration = {
  id: '190-parts-and-services',
  description:
    'Relabels the part def "Parts & Services" (singular "Item") with a `service` part_kind, ' +
    'adds the selling fields and channelCost/standardCostOrigin, and deletes catalog_item ' +
    '(107 D1-D5, 106 D5, D9). No backfill',

  async up(db: Database, organizationId: string): Promise<Migration190Result> {
    const state: State = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    const partDef = existing.entityDefs.get(PART)

    let relabel = { labelsRenamed: false, serviceOptionAdded: false }
    if (partDef) {
      relabel = await relabelPartAndAddService(db, organizationId, partDef.id, existing)
      await addSellingFields(db, organizationId, partDef.id, existing, state)
      await addCostFields(db, organizationId, partDef.id, existing, state)
    }
    const removal = await removeCatalogItem(db, organizationId)

    const result = { ...relabel, ...removal }
    const changed =
      relabel.labelsRenamed ||
      relabel.serviceOptionAdded ||
      state.fieldsCreated > 0 ||
      removal.partnerFieldsRemoved > 0 ||
      removal.catalogItemDefDeleted ||
      removal.groupEntriesCleared > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 190 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
        ...result,
      })
    }

    return { ...state, alreadyUpToDate: !changed, ...result }
  },
}
