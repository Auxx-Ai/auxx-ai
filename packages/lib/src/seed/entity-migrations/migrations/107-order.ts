// packages/lib/src/seed/entity-migrations/migrations/107-order.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { WORK_ORDER_FIELDS } from '../../../resources/registry/resources/work-order-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { DEFAULT_VIEW_CONFIGS } from '../../default-view-configs'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureDefaultTableViews,
  ensureEntityDefinitions,
  ensureFieldViews,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
  resolveFreeSlug,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:107')

/** The display name the renamed-aside incumbent takes (08 §3.4). */
const ASIDE_SINGULAR = 'Custom Order'
const ASIDE_PLURAL = 'Custom Orders'
/** Base slug for the renamed-aside incumbent — `custom-orders`, `custom-orders-2`, … */
const ASIDE_SLUG_BASE = 'custom-orders'

/**
 * Step 0 — rename an incumbent `orders` def aside so the system def can take
 * the canonical slug (plans/products/08-order-build.md §3.2).
 *
 * `EntityDefinition_apiSlug_organizationId_key` is unique on
 * `(apiSlug, organizationId)` for non-archived rows, and the retired `order`
 * CRM template claimed `apiSlug: 'orders'`. Left alone,
 * `ensureEntityDefinitions` would fall back to `orders-2` in every org that
 * installed it — and `apiSlug` is the URL segment AND the key permission
 * profiles and agent permission rules match on, so the canonical entity would
 * be reachable under a non-canonical name forever.
 *
 * **Matches on `apiSlug` only.** An earlier draft borrowed 004-company's
 * `OR lower(singular) = 'order'` arm; that is deliberately dropped — a def at a
 * different slug does not collide, so there is nothing to fix, and that arm is
 * how a rename walks into an occupied slug.
 *
 * Everything else about the incumbent is left untouched: its fields, its
 * records, its relationships, its `entityType: NULL`. It stays the user's own
 * custom entity. Relationships survive because a RELATIONSHIP `CustomField`
 * stores its target as `"<entityDefinitionId>:<customFieldId>"` — two cuids,
 * no slug, no singular, no entityType (08 §3.3).
 *
 * The one cosmetic follow-on (08 §3.6): inverse fields OTHER defs contributed
 * to the incumbent are named "Orders", and `ORDER_FIELDS.contact` / `.company`
 * declare an inverse of the same name. Rename the incumbent's inbound "Orders"
 * fields to "Custom Orders" so a company panel does not end up with two.
 *
 * Idempotent: a second run finds no `entityType IS NULL` def at `orders` (the
 * system def now holds that slug, and it HAS an entityType), so this is a no-op.
 *
 * @returns the new slug when a rename happened, otherwise null
 */
async function renameIncumbentOrdersAside(
  db: Database,
  organizationId: string
): Promise<string | null> {
  const [incumbent] = await db
    .select({
      id: schema.EntityDefinition.id,
      singular: schema.EntityDefinition.singular,
    })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        isNull(schema.EntityDefinition.entityType),
        isNull(schema.EntityDefinition.archivedAt),
        eq(schema.EntityDefinition.apiSlug, 'orders')
      )
    )
    .limit(1)

  if (!incumbent) return null

  const takenSlugs = new Set(
    (
      await db
        .select({ apiSlug: schema.EntityDefinition.apiSlug })
        .from(schema.EntityDefinition)
        .where(
          and(
            eq(schema.EntityDefinition.organizationId, organizationId),
            isNull(schema.EntityDefinition.archivedAt)
          )
        )
    ).map((d) => d.apiSlug)
  )

  const asideSlug = resolveFreeSlug(ASIDE_SLUG_BASE, takenSlugs)
  const now = new Date()

  await db
    .update(schema.EntityDefinition)
    .set({
      apiSlug: asideSlug,
      singular: ASIDE_SINGULAR,
      plural: ASIDE_PLURAL,
      updatedAt: now,
    })
    .where(eq(schema.EntityDefinition.id, incumbent.id))

  // §3.6 — inbound "Orders" inverses now point at a def called "Custom Orders".
  // Scoped to fields whose `options.relationship.inverseResourceFieldId` starts
  // with this def's id, so nothing pointing elsewhere is touched.
  await db
    .update(schema.CustomField)
    .set({ name: ASIDE_PLURAL, updatedAt: now })
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.name, 'Orders'),
        sql`${schema.CustomField.options} -> 'relationship' ->> 'inverseResourceFieldId' LIKE ${`${incumbent.id}:%`}`
      )
    )

  // Deliberately loud: a slug rename moves the entity's URL segment and the key
  // permission profiles and agent permission rules match on. Five disposable
  // test orgs is acceptable as-is; a real org turning up should be visible.
  logger.warn('Renamed an incumbent custom `orders` entity aside for the system order def', {
    organizationId,
    entityDefinitionId: incumbent.id,
    previousSingular: incumbent.singular,
    newApiSlug: asideSlug,
  })

  return asideSlug
}

/**
 * Migration 107: the `order` entity — the third **totalled** money document
 * beside `quote` and `invoice` (plans/products/08-order-build.md §2, §3, §5.1).
 *
 * Def + ORDER_FIELDS + the counterpart halves of its relationship pairs:
 *
 *   order.contact       belongs_to → contact     (`order_contact`,      required)
 *   contact.orders      has_many   → order       (`contact_orders`,     isInverse)
 *   order.company       belongs_to → company     (`order_company`,      nullable)
 *   company.orders      has_many   → order       (`company_orders`,     isInverse)
 *   order.workOrders    has_many   → work_order  (`order_work_orders`,  isInverse)
 *   work_order.order    belongs_to → order       (`work_order_order`,   nullable)
 *
 *   line_item.order    belongs_to → order   (`line_item_order`)
 *   order.lineItems     has_many   → line_item (`order_line_items`, isInverse)
 *   line_item.part      belongs_to → part    (`line_item_part`)
 *   part.lineItems      has_many   → line_item (`part_line_items`, isInverse)
 *
 * The last four landed with the money phase (08 §7 phase 2) and were folded back
 * in here rather than given their own migration id: 107 has only ever run on one
 * local dev database, so there is no environment holding a half-applied order.
 * The "a change needs a NEW id" rule in 08 §7.1 applies once a migration has
 * reached a deployed org — until then `run-migration-107.ts` re-applies it
 * idempotently, which is what the local ledger's `applied` row requires.
 *
 * Step 0 renames an incumbent template-installed `orders` def aside — see
 * {@link renameIncumbentOrdersAside}. It runs BEFORE `loadExistingState`, and
 * `db` here is not a transaction, so the rename is committed by the time
 * `ensureEntityDefinitions` reads the org's taken slugs.
 *
 * **No DDL.** `EntityDefinition.entityType` is a `text()` column, so a new
 * entity type is this migration plus the hand-edits to `enums.ts`,
 * `enum-values.ts`, `field-registry.ts`, `create-fields.ts`, `constants.ts`,
 * `types/resource/utils.ts` and the system-attribute union. Mirrors the 101/103
 * recipe.
 *
 * Note the id space is shared across `data-migrations/migrations/` and
 * `seed/entity-migrations/migrations/` — 107 is the next free number counted
 * across BOTH, not just this directory.
 *
 * Idempotent — every helper is insert-only or skips existing rows, and step 0
 * no-ops once the system def holds `orders`.
 */
export const migration107Order: EntityMigration = {
  id: '107-order',
  description:
    'Add order as a system entity (the third totalled money document), renaming any incumbent ' +
    'template-installed `orders` entity aside to `custom-orders`',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    // Step 0 — must commit before the ensure step reads free slugs.
    const renamedAsideSlug = await renameIncumbentOrdersAside(db, organizationId)

    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'order'),
      existing,
      state
    )

    // Pull the edge targets into the id map so linkNewRelationships can resolve
    // both directions of each pair.
    for (const type of ['contact', 'company', 'work_order', 'line_item', 'part'] as const) {
      const def = existing.entityDefs.get(type)
      if (def) entityDefIds.set(type, def.id)
    }

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    const merge = (m: typeof allFieldMaps) => {
      for (const [k, v] of m) allFieldMaps.set(k, v)
    }

    const orderDefId = entityDefIds.get('order')
    if (orderDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'order',
          orderDefId,
          ORDER_FIELDS,
          existing,
          state
        )
      )
    }

    // The `contact_orders` inverse of `order_contact`.
    const contactDefId = entityDefIds.get('contact')
    if (contactDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'contact',
          contactDefId,
          { orders: CONTACT_FIELDS.orders! },
          existing,
          state
        )
      )
    }

    // The `company_orders` inverse of `order_company`.
    const companyDefId = entityDefIds.get('company')
    if (companyDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'company',
          companyDefId,
          { orders: COMPANY_FIELDS.orders! },
          existing,
          state
        )
      )
    }

    // The `work_order_order` owning half of `order_work_orders`.
    const workOrderDefId = entityDefIds.get('work_order')
    if (workOrderDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'work_order',
          workOrderDefId,
          { order: WORK_ORDER_FIELDS.order! },
          existing,
          state
        )
      )
    }

    // The `line_item_order` / `line_item_part` owning halves and the
    // `part_line_items` inverse. `order.lineItems` (`order_line_items`) is
    // created by the ORDER_FIELDS pass above, and `linkNewRelationships` only
    // writes `inverseResourceFieldId` when it is currently null — so both
    // directions of both pairs resolve in the single pass below.
    //
    // `line_item_part` is STAMPED, not hand-set (08 §6.2): the
    // resolve-from-catalog-item hook and the backfill over existing lines are
    // phase 4, so the field is empty until then.
    const lineItemDefId = entityDefIds.get('line_item')
    const partDefId = entityDefIds.get('part')
    if (lineItemDefId) {
      // `part` is only offered when the org has a `part` def — creating it
      // without one would leave a permanently dangling relationship field.
      const lineItemFields: Record<string, ResourceField> = { order: LINE_ITEM_FIELDS.order! }
      if (partDefId) lineItemFields.part = LINE_ITEM_FIELDS.part!
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'line_item',
          lineItemDefId,
          lineItemFields,
          existing,
          state
        )
      )
    }

    if (partDefId && lineItemDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'part',
          partDefId,
          { lineItems: PART_FIELDS.lineItems! },
          existing,
          state
        )
      )
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['order'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    // Panel and table field views are deliberately NOT seeded: their visibility
    // and order are computed live from the registry (`showInPanel` / `showInTable`
    // / `systemSortOrder`), so a default change stays code-only. See the contract
    // in `entity-seeder/create-field-views.ts`. An earlier revision of this
    // migration seeded both, copying migrations 101/103 which predate that change;
    // the stored rows overrode the registry and froze the table's columns, so they
    // are removed here. Scoped by `tableId: defId` — the saved "All Orders" view
    // lives at `entity-${defId}` and is untouched.
    if (orderDefId) {
      await db
        .delete(schema.TableView)
        .where(
          and(
            eq(schema.TableView.organizationId, organizationId),
            eq(schema.TableView.tableId, orderDefId),
            inArray(schema.TableView.contextType, ['panel', 'table'])
          )
        )
    }

    // The create dialog IS materialized — it is an allowlist, which the registry
    // has no per-field way to express (same contract file as above).
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'order',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: ['order_contact', 'order_company', 'order_placed_at'],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    // The saved "All Orders" table view, for orgs that already exist (fresh orgs
    // get it from `entity-seeder/create-default-views.ts`, same configs). Idempotent
    // — skips if a TableView already exists for this entity.
    if (orderDefId) {
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        'order',
        orderDefId,
        DEFAULT_VIEW_CONFIGS.order,
        allFieldMaps
      )
    }

    const alreadyUpToDate =
      renamedAsideSlug === null &&
      state.entityDefsCreated === 0 &&
      state.fieldsCreated === 0 &&
      state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 107 applied', { organizationId, renamedAsideSlug, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
