// packages/lib/src/seed/entity-migrations/migrations/041-quote-acceptance-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:041')

/**
 * Migration 041: Add the client-quote-acceptance fields to the `quote` entity (v5 build spec
 * 01 — client-facing quote acceptance page). Mirrors the 036 `invoice.publicToken` recipe:
 * fresh orgs get these for free via `QUOTE_FIELDS` (entity-seeder/create-fields.ts); this
 * migration backfills orgs that installed `quote` (032) before these fields existed.
 *
 * Four fields, all FieldValueService-only writers (never user-editable):
 * - `publicToken` — hidden capability token backing the public `/quote/{token}` page.
 * - `acceptedByName` / `acceptedAt` / `declineReason` — acceptance evidence stamped by
 *   `acceptQuoteByToken` / `declineQuoteByToken` (not hidden — visible on the quote record).
 *
 * No DDL, no `ensureFieldViews` change — `publicToken` carries `capabilities.hidden: true`;
 * the other three are read-only but visible, same shape as any hook-written system field.
 */
export const migration041QuoteAcceptanceFields: EntityMigration = {
  id: '041-quote-acceptance-fields',
  description: 'Add quote.publicToken/acceptedByName/acceptedAt/declineReason fields',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const quoteDef = existing.entityDefs.get('quote')
    if (!quoteDef) {
      // Org never got MQ1's quote entity — nothing to backfill; 032/entity-seeder will bring
      // these fields along whenever quote itself is created.
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'quote',
      quoteDef.id,
      {
        publicToken: QUOTE_FIELDS.publicToken!,
        acceptedByName: QUOTE_FIELDS.acceptedByName!,
        acceptedAt: QUOTE_FIELDS.acceptedAt!,
        declineReason: QUOTE_FIELDS.declineReason!,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 041 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
