// packages/lib/src/seed/entity-migrations/migrations/032-money-quoting.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { CATALOG_ITEM_FIELDS } from '../../../resources/registry/resources/catalog-item-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { SERVICE_REQUEST_FIELDS } from '../../../resources/registry/resources/service-request-fields'
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
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:032')

/**
 * Migration 032: Money MQ1 quoting entities — `catalog_item`, `quote`, and `line_item`.
 *
 * Def + fields + contact/service_request/work_order/part inverse relationships + default
 * field/table views. Also adds the `work_order.quote` (owning) and `work_order.lineItems`
 * (inverse) fields — neither existed when 029/030 ran, since `quote`/`line_item` didn't exist
 * yet — the same "add a field to an already-existing def" shape as 020-article-new-fields.ts
 * and 030's `work_order.request` addition.
 *
 * No DDL — these are pure EntityInstance defs.
 *
 * See plans/dispatch/money/03-mq1-build.md §D.
 */
export const migration032MoneyQuoting: EntityMigration = {
  id: '032-money-quoting',
  description: 'Add catalog_item, quote, and line_item as system entities (Money MQ1 quoting)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => ['catalog_item', 'quote', 'line_item'].includes(e.entityType)),
      existing,
      state
    )

    // Pull inverse targets into the id map so linking can resolve them
    for (const type of ['contact', 'service_request', 'work_order', 'part'] as const) {
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

    const catalogItemDefId = entityDefIds.get('catalog_item')
    if (catalogItemDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'catalog_item',
          catalogItemDefId,
          CATALOG_ITEM_FIELDS,
          existing,
          state
        )
      )
    }

    const quoteDefId = entityDefIds.get('quote')
    if (quoteDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'quote',
          quoteDefId,
          QUOTE_FIELDS,
          existing,
          state
        )
      )
    }

    const lineItemDefId = entityDefIds.get('line_item')
    if (lineItemDefId) {
      // No `invoice` field to exclude — the invoice def doesn't exist until MI1, and the
      // registry itself has no `invoice` key yet (§B.2 note), so all fields ship here.
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'line_item',
          lineItemDefId,
          LINE_ITEM_FIELDS,
          existing,
          state
        )
      )
    }

    // Existing-def additions — fields that reference the newly-created defs above.
    const workOrderDefId = entityDefIds.get('work_order')
    if (workOrderDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'work_order',
          workOrderDefId,
          // `quote` (owning belongs_to) + `lineItems` (inverse of line_item.workOrder) — neither
          // existed when 029 ran, since quote/line_item didn't exist in the registry yet.
          { quote: WORK_ORDER_FIELDS.quote!, lineItems: WORK_ORDER_FIELDS.lineItems! },
          existing,
          state
        )
      )
    }
    const contactDefId = entityDefIds.get('contact')
    if (contactDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'contact',
          contactDefId,
          { quotes: CONTACT_FIELDS.quotes! },
          existing,
          state
        )
      )
    }
    const serviceRequestDefId = entityDefIds.get('service_request')
    if (serviceRequestDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'service_request',
          serviceRequestDefId,
          { quotes: SERVICE_REQUEST_FIELDS.quotes! },
          existing,
          state
        )
      )
    }
    const partDefId = entityDefIds.get('part')
    if (partDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'part',
          partDefId,
          { catalogItems: PART_FIELDS.catalogItems! },
          existing,
          state
        )
      )
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['quote', 'line_item', 'catalog_item'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'quote',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'quote_line_items',
            'quote_work_orders',
          ],
        },
        {
          entityType: 'quote',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'quote_line_items',
            'quote_work_orders',
            'quote_notes',
            'quote_terms',
            'quote_discount_type',
            'quote_discount_value',
            'quote_tax_name',
          ],
        },
        {
          entityType: 'quote',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: ['quote_title', 'quote_contact', 'quote_request'],
        },
        {
          entityType: 'line_item',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'line_item',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'line_item_discount',
            'line_item_sort_order',
            'line_item_visit_id',
          ],
        },
        {
          entityType: 'catalog_item',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'catalog_item',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'catalog_item_line_items',
          ],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    // Seed the Kanban "Quote Pipeline" + table "All Quotes" saved views — without this,
    // migrated orgs fall back to the runtime plain table, not the Kanban default fresh orgs
    // get from `createDefaultViews`. No entries for the hidden defs (no records surface).
    if (quoteDefId) {
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        'quote',
        quoteDefId,
        DEFAULT_VIEW_CONFIGS.quote,
        allFieldMaps
      )
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 032 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
