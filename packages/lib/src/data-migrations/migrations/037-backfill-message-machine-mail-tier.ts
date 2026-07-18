// packages/lib/src/data-migrations/migrations/037-backfill-message-machine-mail-tier.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-037')

/**
 * Machine-mail plan Phase 1: `Message.machineMailTier` becomes a first-class column
 * (migration 0296). New ingests write it directly; rows flagged before the column
 * existed only carry `metadata.machineMail.tier`. Backfill copies the tier into the
 * column so the answer-node backstop and future inbox filters see pre-column messages.
 *
 * Idempotent: only touches rows where the column is still NULL.
 */
export const migration037BackfillMessageMachineMailTier: DataMigrationDef = {
  id: '037-backfill-message-machine-mail-tier',
  description: 'Copy Message.metadata.machineMail.tier into the machineMailTier column',
  async run(db: Database): Promise<void> {
    const result = await db.execute(sql`
      UPDATE "Message"
      SET "machineMailTier" = (metadata -> 'machineMail' ->> 'tier')::"MachineMailTier"
      WHERE "machineMailTier" IS NULL
        AND metadata -> 'machineMail' ->> 'tier' IN ('hard', 'soft')
    `)

    logger.info('Backfilled Message.machineMailTier from metadata', {
      rowsUpdated: result.rowCount ?? 0,
    })
  },
}
