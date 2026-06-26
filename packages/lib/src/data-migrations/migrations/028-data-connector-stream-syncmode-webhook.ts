// packages/lib/src/data-migrations/migrations/028-data-connector-stream-syncmode-webhook.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-028')

/**
 * Retire the `'webhook'` value of `DataConnectorStream.syncMode`. Steering is now an
 * orthogonal trigger concern (`syncBehavior='webhook'` + `requestConfig.webhookTrigger`),
 * not a completeness mode — see SyncMode in @auxx/lib data-connectors/types and
 * plans/data-connectors/v3/steered-vs-full-run-determination.md.
 *
 * The UI already treated `'webhook'` as snapshot ("treat webhook as snapshot here"), so
 * folding these rows to `'snapshot'` preserves the intended completeness AND unlocks orphan
 * reconciliation on their sweeps (the old `'webhook'` value silently skipped it). Idempotent:
 * only touches rows still set to `'webhook'`.
 */
export const migration028DataConnectorStreamSyncModeWebhook: DataMigrationDef = {
  id: '028-data-connector-stream-syncmode-webhook',
  description: "Fold DataConnectorStream.syncMode='webhook' rows to 'snapshot'",
  async run(db: Database): Promise<void> {
    const result = await db.execute(sql`
      UPDATE "DataConnectorStream"
         SET "syncMode" = 'snapshot'
       WHERE "syncMode" = 'webhook'
    `)
    logger.info('Folded webhook syncMode streams to snapshot', {
      rowCount: (result as { rowCount?: number | null }).rowCount ?? 0,
    })
  },
}
