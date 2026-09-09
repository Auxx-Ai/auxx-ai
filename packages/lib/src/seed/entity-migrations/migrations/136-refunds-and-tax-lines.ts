// packages/lib/src/seed/entity-migrations/migrations/136-refunds-and-tax-lines.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RelationDeleteBehavior } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { REFUND_FIELDS } from '../../../resources/registry/resources/refund-fields'
import { REFUND_LINE_FIELDS } from '../../../resources/registry/resources/refund-line-fields'
import { TAX_LINE_FIELDS } from '../../../resources/registry/resources/tax-line-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { buildFieldOptions } from '../../entity-seeder/utils'
import { seedDefaultChartOfAccounts } from '../../gl-account-chart'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  fieldKey,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:136')

/** What {@link ensureCustomFields} returns, keyed `<entityType>:<field id>`. */
type EnsuredFieldMap = Awaited<ReturnType<typeof ensureCustomFields>>

/** The three defs this migration creates. All hidden: they render inside the order. */
const NEW_ENTITY_TYPES = ['refund', 'refund_line', 'tax_line'] as const

/** The def the chart addition needs. Absent means the org has no chart at all. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/**
 * Every relationship pair this migration must LINK, as
 * `<owning entityType>:<field id>` paired with the inverse it points at.
 *
 * Checked explicitly after {@link linkNewRelationships} rather than trusted,
 * because that helper only logs a debug line when it cannot resolve an inverse.
 * Entity migration 135 is why: an UNLINKED relationship is worse than a missing
 * one - the field exists so writes are accepted, but with no inverse the other
 * side reads empty and every consumer of it silently sees nothing.
 */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  { owning: `refund:${REFUND_FIELDS.order?.id}`, inverse: 'order:refunds' },
  { owning: `refund_line:${REFUND_LINE_FIELDS.refund?.id}`, inverse: 'refund:lines' },
  { owning: `refund_line:${REFUND_LINE_FIELDS.lineItem?.id}`, inverse: 'line_item:refundLines' },
  { owning: `tax_line:${TAX_LINE_FIELDS.order?.id}`, inverse: 'order:taxLines' },
]

/** New fields added to defs that ALREADY exist, by entity type. */
const WIDENED: readonly {
  entityType: string
  source: Record<string, ResourceField>
  keys: string[]
}[] = [
  { entityType: 'order', source: ORDER_FIELDS, keys: ['refunds', 'taxLines'] },
  { entityType: 'line_item', source: LINE_ITEM_FIELDS, keys: ['taxTotal', 'refundLines'] },
  { entityType: 'contact', source: CONTACT_FIELDS, keys: ['taxExempt'] },
]

/**
 * Migration 136: refunds and channel-computed tax.
 *
 * Two plans land together because they share one connector field batch and one
 * per-org remap, and the remap cost is per batch: doing them separately pays it
 * twice (plans/money/tasks/48-shopify-tax-data.md §5).
 *
 * ## What it adds
 *
 * - **`refund` + `refund_line`** (47 §2, §5.1) - a refund that already happened
 *   at the sales channel, ingested as a FACT. Never originated here: the
 *   existing `refundTransaction` calls Stripe's API and the ledger refuses
 *   anything else, which is the opposite direction (47 §0.4).
 * - **`tax_line`** (48 §4.1) - one jurisdiction's share of one order's tax, as
 *   a ROW. Multi-jurisdiction is the norm, so a single rate on the order can
 *   never represent it, and the question being asked is tax by jurisdiction over
 *   a period, which is an aggregation and wants rows.
 * - **Four relationship pairs**, plus `line_item_tax_total` and
 *   `contact_tax_exempt` on defs that already exist.
 * - **`4090 Sales Returns and Allowances`** with its
 *   `revenue_returns_allowances` role (47 §6.1).
 * - **The delete-behavior stamp** (plans/relationships/01-delete-semantics.md).
 *   `options.relationship.onDelete` on every stored system relationship field
 *   of the org, copied from the registry, and the retired
 *   `constraints.onDeleteWithChildren` stripped wherever it is still stored.
 *   The seeder copies `onDelete` into stored options for a NEW org only; an
 *   existing org keeps whatever was copied the day it was seeded, which is
 *   nothing. It runs LAST so the four owning fields this migration creates are
 *   covered whether this run created them or an earlier one did.
 * - **The three seed-only self-relation pairs, linked.** `build.reversalOf` /
 *   `reversedBy`, `stock_movement.parentMovement` / `childMovements` and
 *   `stock_movement.reversesMovement` / `reversedByMovements` carry
 *   `relationshipConfig` alone, and until this change the seeder ignored that
 *   block: every org seeded after migration 003 holds those six rows with
 *   `options = {"isCustom": false}`, no `relationship` block, no inverse. The
 *   delete engine cannot act on an edge it cannot see, so the pair is linked
 *   the way 003 step 2 linked it, right before the stamp gives it `onDelete`.
 *
 * ## What it deliberately does NOT do
 *
 * 🛑 **No backfill, and none is possible.** Every field here is filled by the
 * connector, and the refund and tax data does not exist anywhere in auxx today
 * to backfill FROM - 47 §0.1: the connector carries 25 `order_*` attributes and
 * not one is a refund. The rows arrive on the next sync after the connector
 * bindings and the remap land, which is a separate change in a separate repo.
 *
 * ⚠️ **`4090` ships with a role that nothing emits yet.** `build-refund-entry.ts`
 * is 47 §5.3 and waits on decisions still open there. The `ACCOUNT_ROLES` header
 * names this exact state as a hazard - a role nothing emits is a mapping a
 * bookkeeper can make wrongly with no way to find out - so the builder should
 * follow closely rather than eventually.
 *
 * ## Ordering
 *
 * MUST sort after 107 (which creates `order` and `line_item`) and after 108
 * (which owns the chart). An org short of either is a skip, not a failure.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only and skips a field that exists,
 * `linkNewRelationships` only writes an unset inverse,
 * `seedDefaultChartOfAccounts` is idempotent on `code` with its role insert
 * `ON CONFLICT DO NOTHING`, and the stamp writes a row only when its stored
 * options differ from what the registry says.
 */
export const migration136RefundsAndTaxLines: EntityMigration = {
  id: '136-refunds-and-tax-lines',
  description:
    'Adds the refund, refund_line and tax_line defs with their relationships to order and ' +
    'line_item, line_item_tax_total and contact_tax_exempt, and 4090 Sales Returns and ' +
    'Allowances - the records the channel connector fills for refund and tax posting; ' +
    'stamps options.relationship.onDelete from the registry onto every stored system ' +
    'relationship field and strips the retired constraints.onDeleteWithChildren',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      deleteBehaviorsStamped: 0,
    }
    const existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org short of 107 has no order or line_item,
    // and the seeder creates all of this with the rest of the registry.
    const orderDef = existing.entityDefs.get('order')
    const lineItemDef = existing.entityDefs.get('line_item')
    const contactDef = existing.entityDefs.get('contact')
    if (!orderDef || !lineItemDef || !contactDef) return { ...state, alreadyUpToDate: true }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_ENTITY_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )
    entityDefIds.set('order', orderDef.id)
    entityDefIds.set('line_item', lineItemDef.id)
    entityDefIds.set('contact', contactDef.id)

    // 🛑 ONE field map spanning EVERY def, new and widened alike.
    // `linkNewRelationships` resolves an inverse out of this map by
    // `<entityType>:<field id>`, so linking the halves of a pair in separate
    // calls would leave each unable to see the other and skip the pair with
    // nothing louder than a debug line (the 135 lesson).
    const fieldMap: EnsuredFieldMap = new Map()

    const newDefFields: Record<string, Record<string, ResourceField>> = {
      refund: REFUND_FIELDS,
      refund_line: REFUND_LINE_FIELDS,
      tax_line: TAX_LINE_FIELDS,
    }
    for (const entityType of NEW_ENTITY_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        newDefFields[entityType]!,
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    for (const { entityType, source, keys } of WIDENED) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        pick(source, keys, entityType),
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)

    await linkDisplayFields(db, [...NEW_ENTITY_TYPES], entityDefIds, fieldMap)

    // Read the org's fields FRESH rather than reusing `existing` from the top:
    // `linkNewRelationships` has written `inverseResourceFieldId` into stored
    // options since, and spreading the stale snapshot into an UPDATE would
    // erase that link on the very fields this migration just created. Both
    // steps below run after every insert and link, so the four owning fields
    // this migration adds are stamped in the same run that created them.
    const current = await loadExistingState(db, organizationId)
    await linkSeedOnlyPairs(db, current, state)
    state.deleteBehaviorsStamped = await stampDeleteBehaviors(db, current)

    // Idempotent on `code`; its role insert is ON CONFLICT DO NOTHING. An org
    // short of 108 has no chart def and gets no chart work, the way 133 skips.
    const glAccountDefId = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)?.id
    const chart = glAccountDefId
      ? await seedDefaultChartOfAccounts(db, organizationId, glAccountDefId)
      : { created: 0, rolesAssigned: 0 }

    const changed =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      state.relationshipsLinked > 0 ||
      state.deleteBehaviorsStamped > 0 ||
      chart.created > 0 ||
      chart.rolesAssigned > 0

    if (changed) {
      // A new def and a new field are invisible to every read path that serves
      // them until the per-org caches are dropped. `runEntityMigrationsForOrg`
      // does this after the whole batch, but `up()` can also be called directly.
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 136 applied', {
        organizationId,
        ...state,
        accountsCreated: chart.created,
        rolesAssigned: chart.rolesAssigned,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/** The registry fields this migration adds to an existing def, loud if one was renamed. */
function pick(
  source: Record<string, ResourceField>,
  keys: readonly string[],
  entityType: string
): Record<string, ResourceField> {
  const picked: Record<string, ResourceField> = {}
  for (const key of keys) {
    const field = source[key]
    if (!field) {
      throw new Error(`${entityType} registry is missing the key "${key}" (migration 136)`)
    }
    picked[key] = field
  }
  return picked
}

/**
 * Verify every pair in {@link RELATIONSHIP_PAIRS} actually resolved its inverse.
 *
 * 🛑 Not a formality. `linkNewRelationships` skips an unresolvable pair with a
 * debug line, so without this the migration reports success having created four
 * relationship fields that accept writes the other side cannot see. Entity
 * migration 135 added the same assertion for one pair after exactly that.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) {
      throw new Error(`migration 136 could not resolve the field ${owning}`)
    }
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 136 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}

// ─── The seed-only self-relation pairs ───────────────────────────────

/** What {@link loadExistingState} returns. */
type OrgState = Awaited<ReturnType<typeof loadExistingState>>

/**
 * Every registry field that describes its relationship through
 * `relationshipConfig` alone: the three self-relation pairs, six fields. A
 * field carrying both blocks is a normal pair and `linkNewRelationships` owns it.
 */
export function collectSeedOnlyRelationshipFields(): {
  entityType: string
  field: ResourceField
}[] {
  // The seeder's map, not RESOURCE_FIELD_REGISTRY: `tag` is seeded but absent from the latter.
  const registry = FIELD_REGISTRY
  const out: { entityType: string; field: ResourceField }[] = []
  for (const [entityType, fields] of Object.entries(registry)) {
    for (const field of Object.values(fields)) {
      if (field.relationshipConfig && !field.relationship && field.systemAttribute) {
        out.push({ entityType, field })
      }
    }
  }
  return out
}

/**
 * Give every seed-only pair whose stored row has no `relationship` block the
 * block the seeder now writes, with the inverse resolved by
 * `(relatedEntityType, inverseSystemAttribute)`. Modelled on migration 003
 * step 2, generic over the registry. A row that already carries a block is
 * never touched, whichever migration or seeder gave it one.
 *
 * The block itself comes from `buildFieldOptions`, so the shape is defined once
 * for the seeder and this migration alike; only the inverse id is filled in.
 * The in-memory row is updated too, so the stamp that follows sees the block.
 *
 * No FieldValue backfill: the delete engine reads the CHILD-side row
 * (`relatedEntityId IN parents AND fieldId = the belongs_to field`), and those
 * rows exist for every movement and build written so far.
 */
export async function linkSeedOnlyPairs(
  db: Database,
  current: OrgState,
  state: { relationshipsLinked: number }
): Promise<void> {
  const now = new Date()

  for (const { entityType, field } of collectSeedOnlyRelationshipFields()) {
    const config = field.relationshipConfig!
    const def = current.entityDefs.get(entityType)
    if (!def) continue
    const row = current.fields.get(fieldKey(def.id, field.systemAttribute!))
    if (!row || row.options?.relationship) continue

    const relatedDef = current.entityDefs.get(config.relatedEntityType)
    const inverse = relatedDef
      ? current.fields.get(fieldKey(relatedDef.id, config.inverseSystemAttribute))
      : undefined
    if (!relatedDef || !inverse) {
      logger.warn('Seed-only pair has no inverse row to link to; skipping', {
        field: `${entityType}:${field.systemAttribute}`,
        inverse: `${config.relatedEntityType}:${config.inverseSystemAttribute}`,
      })
      continue
    }

    const block = buildFieldOptions(field).relationship!
    const options: FieldOptions = {
      ...row.options,
      relationship: {
        ...block,
        inverseResourceFieldId: toResourceFieldId(relatedDef.id, inverse.id),
      },
    }

    await db
      .update(schema.CustomField)
      .set({ options, updatedAt: now })
      .where(eq(schema.CustomField.id, row.id))

    row.options = options
    state.relationshipsLinked++
    logger.debug(`Linked seed-only pair: ${entityType}:${field.systemAttribute}`)
  }
}

// ─── The delete-behavior stamp ───────────────────────────────────────

/**
 * Every registry-declared delete behavior, keyed `<entityType>:<systemAttribute>`,
 * which is how a stored `CustomField` row is addressed within one org.
 *
 * Both declaration sites count: `relationship.onDelete` on a linked pair, and
 * `relationshipConfig.onDelete` on the three seed-only self-relations that
 * {@link linkSeedOnlyPairs} has just given a block. The registry never declares
 * it on a belongs_to side, so a stored belongs_to row is only ever stripped,
 * never stamped.
 */
export function collectDeleteBehaviorStamps(): Map<string, RelationDeleteBehavior> {
  const stamps = new Map<string, RelationDeleteBehavior>()
  // The seeder's map, not RESOURCE_FIELD_REGISTRY: `tag` is seeded but absent from the latter.
  const registry = FIELD_REGISTRY
  for (const [entityType, fields] of Object.entries(registry)) {
    for (const field of Object.values(fields)) {
      if (!field.systemAttribute) continue
      const onDelete = field.relationship?.onDelete ?? field.relationshipConfig?.onDelete
      if (onDelete === undefined) continue
      stamps.set(`${entityType}:${field.systemAttribute}`, onDelete)
    }
  }
  return stamps
}

/**
 * The stored options after the stamp, or `null` when nothing would change.
 *
 * Two edits, both inside `options.relationship`: set `onDelete` to the registry
 * value when one is given and the stored value differs, and drop the retired
 * `constraints.onDeleteWithChildren` (removing `constraints` outright once it is
 * empty, keeping `preventCircular` / `maxDepth` when they are there). Every
 * other key, `inverseResourceFieldId` above all, passes through untouched.
 *
 * A row with no `relationship` block is returned as unchanged on purpose: a
 * block holding only `onDelete` has no `relationshipType` and no inverse, and
 * the delete engine would read it as an owning edge it cannot follow. After
 * {@link linkSeedOnlyPairs} no system relationship row should be in that state.
 */
export function withDeleteBehavior(
  options: FieldOptions | null | undefined,
  onDelete: RelationDeleteBehavior | undefined
): FieldOptions | null {
  const relationship = options?.relationship
  if (!relationship) return null

  let changed = false
  const next = { ...relationship }

  const constraints = relationship.constraints as Record<string, unknown> | undefined
  if (constraints && 'onDeleteWithChildren' in constraints) {
    const { onDeleteWithChildren: _retired, ...kept } = constraints
    if (Object.keys(kept).length > 0) next.constraints = kept
    else delete next.constraints
    changed = true
  }

  if (onDelete !== undefined && relationship.onDelete !== onDelete) {
    next.onDelete = onDelete
    changed = true
  }

  return changed ? { ...options, relationship: next } : null
}

/**
 * Stamp the registry's `onDelete` onto the org's stored system relationship
 * fields and strip `onDeleteWithChildren`. Returns the number of rows written.
 *
 * `current` must be loaded after every other write in `up()` (see the call
 * site): a stale options snapshot spread into an UPDATE erases whatever was
 * written since, the inverse links above all.
 *
 * One UPDATE per changed row. Roughly 70 rows per org on the first run (the
 * registry declares about that many owning edges, plus the two `*_parent`
 * rows still carrying `onDeleteWithChildren`) and zero on every run after,
 * because a stored row that already matches the registry is never written.
 */
async function stampDeleteBehaviors(db: Database, current: OrgState): Promise<number> {
  const stamps = collectDeleteBehaviorStamps()

  const entityTypeByDefId = new Map<string, string>()
  for (const def of current.entityDefs.values()) entityTypeByDefId.set(def.id, def.entityType)

  const now = new Date()
  let written = 0

  for (const field of current.fields.values()) {
    const entityType = entityTypeByDefId.get(field.entityDefinitionId)
    if (!entityType) continue

    const next = withDeleteBehavior(
      field.options,
      stamps.get(`${entityType}:${field.systemAttribute}`)
    )
    if (!next) continue

    await db
      .update(schema.CustomField)
      .set({ options: next, updatedAt: now })
      .where(eq(schema.CustomField.id, field.id))
    written++
  }

  return written
}
