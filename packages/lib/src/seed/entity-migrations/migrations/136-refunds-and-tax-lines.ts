// packages/lib/src/seed/entity-migrations/migrations/136-refunds-and-tax-lines.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { REFUND_FIELDS } from '../../../resources/registry/resources/refund-fields'
import { REFUND_LINE_FIELDS } from '../../../resources/registry/resources/refund-line-fields'
import { TAX_LINE_FIELDS } from '../../../resources/registry/resources/tax-line-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { seedDefaultChartOfAccounts } from '../../gl-account-chart'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
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
 * `linkNewRelationships` only writes an unset inverse, and
 * `seedDefaultChartOfAccounts` is idempotent on `code` with its role insert
 * `ON CONFLICT DO NOTHING`.
 */
export const migration136RefundsAndTaxLines: EntityMigration = {
  id: '136-refunds-and-tax-lines',
  description:
    'Adds the refund, refund_line and tax_line defs with their relationships to order and ' +
    'line_item, line_item_tax_total and contact_tax_exempt, and 4090 Sales Returns and ' +
    'Allowances - the records the channel connector fills for refund and tax posting',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
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
