// packages/lib/src/seed/entity-migrations/migrations/030-service-request.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { SERVICE_REQUEST_FIELDS } from '../../../resources/registry/resources/service-request-fields'
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

const logger = createScopedLogger('entity-migrations:030')

/**
 * Migration 030: Service Request system entity (Dispatch M1 — the primary intake door).
 * Def + fields + contact/ticket inverse relationships + default field/table views, PLUS the
 * `work_order.request` field (belongs_to service_request) that 029 deliberately skipped —
 * service_request now exists, so it can link.
 *
 * See plans/dispatch/03-m1-records.md §D.2.
 */
export const migration030ServiceRequest: EntityMigration = {
  id: '030-service-request',
  description: 'Add service request as a system entity (Dispatch M1 primary intake)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'service_request'),
      existing,
      state
    )

    // Pull inverse targets AND work_order (029 already created it) into the id map
    for (const type of ['contact', 'ticket', 'work_order'] as const) {
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

    const serviceRequestDefId = entityDefIds.get('service_request')
    if (serviceRequestDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'service_request',
          serviceRequestDefId,
          SERVICE_REQUEST_FIELDS,
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
          { serviceRequests: CONTACT_FIELDS.serviceRequests! },
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
          { serviceRequests: TICKET_FIELDS.serviceRequests! },
          existing,
          state
        )
      )
    }
    // The field 029 skipped — service_request now exists, so this can link.
    const workOrderDefId = entityDefIds.get('work_order')
    if (workOrderDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'work_order',
          workOrderDefId,
          { request: WORK_ORDER_FIELDS.request! },
          existing,
          state
        )
      )
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['service_request'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'service_request',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'service_request',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'service_request_description',
          ],
        },
        {
          entityType: 'service_request',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'service_request_title',
            'service_request_description',
            'service_request_property_type',
            'service_request_preferred_date',
            'service_request_alternate_date',
            'service_request_arrival_window',
            'service_request_contact',
            'service_request_address',
          ],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    // Seed the Kanban "Request Pipeline" + table "All Requests" saved views — without this,
    // migrated orgs fall back to the runtime plain table, not the Kanban default fresh orgs
    // get from `createDefaultViews`.
    if (serviceRequestDefId) {
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        'service_request',
        serviceRequestDefId,
        DEFAULT_VIEW_CONFIGS.service_request,
        allFieldMaps
      )
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 030 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
