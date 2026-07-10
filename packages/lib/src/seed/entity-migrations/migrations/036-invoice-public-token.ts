// packages/lib/src/seed/entity-migrations/migrations/036-invoice-public-token.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:036')

/**
 * Migration 036: Add the hidden `publicToken` field to the `invoice` entity (money MP1 build
 * spec §H) — the unguessable capability token backing the public `/pay/{token}` page. Mirrors
 * the 034 `quote.pdfAsset` recipe: fresh orgs get it for free via `INVOICE_FIELDS`
 * (entity-seeder/create-fields.ts); this migration backfills orgs that installed `invoice`
 * (035) before this field existed.
 *
 * No DDL, no `ensureFieldViews` change — `capabilities.hidden: true` keeps it out of every
 * user-facing surface, and the field is never lazily minted here (04-payments: lazily on
 * first send/PDF-render via `ensureInvoicePublicToken`, not on create/migrate).
 */
export const migration036InvoicePublicToken: EntityMigration = {
  id: '036-invoice-public-token',
  description: 'Add hidden invoice.publicToken field (money MP1 public pay-page token)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const invoiceDef = existing.entityDefs.get('invoice')
    if (!invoiceDef) {
      // Org never got MI1's invoice entity — nothing to backfill; 035/entity-seeder will
      // bring publicToken along whenever invoice itself is created.
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'invoice',
      invoiceDef.id,
      { publicToken: INVOICE_FIELDS.publicToken! },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 036 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
