// packages/lib/src/seed/entity-migrations/migrations/042-quote-deposit-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:042')

/**
 * Migration 042: Add the deposit-on-acceptance fields to the `quote` entity (money MP2 §B.2 —
 * customer payments round 2). Mirrors the 041 `quote.publicToken`/acceptance-evidence recipe:
 * fresh orgs get these for free via `QUOTE_FIELDS` (entity-seeder/create-fields.ts); this
 * migration backfills orgs that installed `quote` (032) before these fields existed.
 *
 * Two fields, both user-editable in the quote editor like any other quote field:
 * - `depositType` — `none | percent | fixed`. Unset falls back to the org default
 *   (`documents.quote.depositType`) when resolving the deposit amount at checkout time.
 * - `depositValue` — percent (0-100) or integer cents, depending on `depositType`.
 *
 * No DDL, no `ensureFieldViews` change — same shape as any other system field backfill.
 */
export const migration042QuoteDepositFields: EntityMigration = {
  id: '042-quote-deposit-fields',
  description: 'Add quote.depositType/depositValue fields',

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
        depositType: QUOTE_FIELDS.depositType!,
        depositValue: QUOTE_FIELDS.depositValue!,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 042 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
