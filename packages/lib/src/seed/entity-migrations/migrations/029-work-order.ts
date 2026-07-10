// packages/lib/src/seed/entity-migrations/migrations/029-work-order.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { TICKET_FIELDS } from '../../../resources/registry/resources/ticket-fields'
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

const logger = createScopedLogger('entity-migrations:029')

/**
 * Migration 029: Work Order system entity (Dispatch M1).
 * Def + fields + contact/company/ticket inverse relationships + default field/table views.
 *
 * The `request` field (belongs_to service_request) is deliberately EXCLUDED here — the
 * service_request entity doesn't exist yet at 029 time. Migration 030 (which runs after this
 * one for every org, per `ALL_MIGRATIONS` ordering) adds `request` to this def once
 * service_request exists, the same "add a field to an already-existing def" shape as
 * 020-article-new-fields.ts.
 *
 * See plans/dispatch/03-m1-records.md §D.1.
 */
export const migration029WorkOrder: EntityMigration = {
  id: '029-work-order',
  description: 'Add work order as a system entity (Dispatch M1)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'work_order'),
      existing,
      state
    )

    // Pull the inverse targets into the id map so linking can resolve them
    for (const type of ['contact', 'company', 'ticket'] as const) {
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

    const workOrderDefId = entityDefIds.get('work_order')
    if (workOrderDefId) {
      const { request: _request, ...fieldsForThisMigration } = WORK_ORDER_FIELDS
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'work_order',
          workOrderDefId,
          fieldsForThisMigration,
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
          { workOrders: CONTACT_FIELDS.workOrders! },
          existing,
          state
        )
      )
    }
    const companyDefId = entityDefIds.get('company')
    if (companyDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'company',
          companyDefId,
          { workOrders: COMPANY_FIELDS.workOrders! },
          existing,
          state
        )
      )
    }
    const ticketDefId = entityDefIds.get('ticket')
    if (ticketDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'ticket',
          ticketDefId,
          { workOrders: TICKET_FIELDS.workOrders! },
          existing,
          state
        )
      )
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['work_order'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'work_order',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'work_order_pricing_model', // hidden billing structure — no UI until invoicing
            'work_order_invoice_timing',
          ],
        },
        {
          entityType: 'work_order',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'work_order_description',
            'work_order_completion_notes',
            'work_order_pricing_model', // hidden billing structure — no UI until invoicing
            'work_order_invoice_timing',
          ],
        },
        {
          entityType: 'work_order',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'work_order_title',
            'work_order_status',
            'work_order_priority',
            'work_order_job_type',
            'work_order_contact',
            'work_order_company',
            'work_order_address',
            'work_order_description',
          ],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    // Also seed the "All Work Orders" saved table view so migrated orgs get the same default
    // table view fresh orgs get from `createDefaultViews`, instead of the runtime fallback
    // plain table.
    if (workOrderDefId) {
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        'work_order',
        workOrderDefId,
        DEFAULT_VIEW_CONFIGS.work_order,
        allFieldMaps
      )
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 029 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
