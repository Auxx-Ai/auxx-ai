// packages/lib/src/seed/entity-migrations/migrations/038-invoice-automation.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../../cache/invalidate'
import { SystemUserService } from '../../../users/system-user-service'
import { DEFAULT_VIEW_CONFIGS } from '../../default-view-configs'
import { resolveViewConfig } from '../../entity-seeder/create-default-views'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:038')

/**
 * Migration 038: Money MI2 invoice automation groundwork.
 *
 * Seeds the "Drafts" saved table view (Q10a) for orgs that already ran 035's
 *    `ensureDefaultTableViews` call. NOTE: `ensureDefaultTableViews` (helpers.ts:459) dedups
 *    per-ENTITY, not per-view — it no-ops entirely the moment ANY TableView exists at
 *    `entity-${invoiceDefId}` (helpers.ts:473-483), which every org that ran 035 already has
 *    ("All Invoices" + "Outstanding"). Calling it again here would silently skip "Drafts"
 *    forever. So this migration inserts the "Drafts" view directly, keyed by its own name for
 *    idempotency, reusing `resolveViewConfig` (the same field-id resolution `createDefaultViews`
 *    and `ensureDefaultTableViews` share) rather than the entity-level helper. Fresh orgs need no
 *    backfill — `createDefaultViews` reads the now-3-entry `DEFAULT_VIEW_CONFIGS.invoice` array
 *    directly at signup.
 *
 * showInPanel note: `work_order.invoiceTiming`'s `showInPanel: false → true` flip (work-order-
 * fields.ts) needed NO migration step — `showInPanel` is never materialized onto the per-org
 * `CustomField` row (`buildFieldOptions`/`mapCapabilities`, entity-seeder/utils.ts, carry no such
 * key); it's read live from the static registry on every request via
 * `mergeSystemAndCustomFields` (resource-registry-service.ts), so the flip took effect for every
 * existing org the moment the registry file changed. No backfill in this migration.
 *
 * No DDL — `RecurrenceRule` (0280) already ships; MI2 needs no invoice-automation DDL.
 *
 * See plans/dispatch/money/08-mi2-build.md §B, §I.
 */
export const migration038InvoiceAutomation: EntityMigration = {
  id: '038-invoice-automation',
  description: 'Add invoice.visitId field + seeded "Drafts" table view (Money MI2 automation)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const invoiceDef = existing.entityDefs.get('invoice')
    if (!invoiceDef) {
      // Org never got MI1's invoice entity — nothing to backfill; entity-seeder brings
      // visitId + the Drafts view along whenever invoice itself is first created.
      return { ...state, alreadyUpToDate: true }
    }

    let viewCreated = false
    const tableId = `entity-${invoiceDef.id}`
    const draftsViewDef = DEFAULT_VIEW_CONFIGS.invoice.find((v) => v.name === 'Drafts')
    if (draftsViewDef) {
      const existingDraftsView = await db
        .select({ id: schema.TableView.id })
        .from(schema.TableView)
        .where(
          and(
            eq(schema.TableView.organizationId, organizationId),
            eq(schema.TableView.tableId, tableId),
            eq(schema.TableView.name, draftsViewDef.name)
          )
        )
        .limit(1)

      if (existingDraftsView.length === 0) {
        // Merge in every invoice field (not just the visitId field ensured above) so `field_*`
        // symbolic references in the Drafts config (e.g. field_invoice_status) resolve.
        // `resolveViewConfig`/`buildFieldIdMap` (entity-seeder/create-default-views.ts) only
        // requires each map key to start with `${entityType}:` — the value's `systemAttribute`
        // drives the actual lookup, so the CustomField id suffix here just keeps keys unique.
        const resolvable = new Map<string, { id: string; systemAttribute: string }>()
        for (const field of existing.fields.values()) {
          if (field.entityDefinitionId === invoiceDef.id) {
            resolvable.set(`invoice:${field.id}`, {
              id: field.id,
              systemAttribute: field.systemAttribute,
            })
          }
        }
        const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
        const resolvedConfig = resolveViewConfig(
          draftsViewDef.config,
          'invoice',
          invoiceDef.id,
          resolvable
        )

        await db.insert(schema.TableView).values({
          organizationId,
          userId: systemUserId,
          tableId,
          name: draftsViewDef.name,
          isDefault: draftsViewDef.isDefault ?? false,
          isShared: true,
          config: resolvedConfig,
          updatedAt: new Date(),
        })

        viewCreated = true

        // Every org member holds a `userTableViews` cache entry (serves tableView.listAll,
        // 1-day TTL) — without this broadcast the seeded view stays invisible in the UI
        // until each member's entry expires (the ensureDefaultTableViews recipe,
        // helpers.ts:508).
        await onCacheEvent('table-view.created', {
          orgId: organizationId,
          broadcastUserKeys: true,
        })

        logger.debug('Created "Drafts" table view for invoice', { organizationId })
      }
    }

    const alreadyUpToDate = state.fieldsCreated === 0 && !viewCreated
    if (!alreadyUpToDate) {
      logger.info('Migration 038 applied', { organizationId, ...state, viewCreated })
    }

    return { ...state, alreadyUpToDate }
  },
}
