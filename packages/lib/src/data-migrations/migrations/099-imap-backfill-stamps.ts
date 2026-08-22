// packages/lib/src/data-migrations/migrations/099-imap-backfill-stamps.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-099')

/** What to stamp on one pre-fix IMAP channel row. */
export type ImapStampPlan = 'both' | 'cutoff-only' | 'skip'

/**
 * Decide the stamps for one IMAP `Integration` row. Insert-only, mirroring the
 * stamps' contract everywhere else (a reconnect must never reopen a closed
 * window): any row that already carries either key is left untouched.
 *
 * - A channel that has ever completed a sync (`lastSuccessfulSync` set)
 *   already imported its history with full fan-out — there is no backfill left
 *   to suppress, so it gets BOTH stamps (a closed window), exactly like
 *   migration 080 did for polling Outlook channels. Leaving
 *   `initialBackfillCompletedAt` unset would suppress `message:received` for
 *   this channel forever under the fail-closed consume side (#1721).
 * - A channel that never completed a sync still owes its first walk: it gets
 *   the cutoff alone (an OPEN window — everything in the mailbox right now is
 *   history), and the walk-end completion stamp closes it.
 */
export function planImapBackfillStamps(row: {
  metadata: unknown
  lastSuccessfulSync: Date | null
}): ImapStampPlan {
  const meta =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}
  if (meta.backfillCutoffAt || meta.initialBackfillCompletedAt) return 'skip'
  return row.lastSuccessfulSync ? 'both' : 'cutoff-only'
}

/**
 * Stamp the backfill-window metadata onto IMAP channels connected before the
 * IMAP backfill-suppression fix (skip-events-history §11 G1).
 *
 * IMAP channels never had `backfillCutoffAt` / `initialBackfillCompletedAt`.
 * The fix makes `ImapProvider.initialize` resolve the window FAIL-CLOSED
 * (neither stamp ⇒ suppress from now, #1721), so without this migration every
 * existing IMAP channel would enter a fresh suppression window at its next
 * poll. Stamping per {@link planImapBackfillStamps} keeps already-backfilled
 * channels fully live and gives never-synced ones a correct open window.
 *
 * Disabled channels are included on purpose: disable is pause-and-catch-up
 * (credentials and cursors kept), and a re-enabled channel with a closed
 * window resolves to no suppression — its catch-up mail fires normally.
 *
 * Raw Drizzle jsonb merge on purpose (data-migration convention, and the
 * provider's own metadata writes are jsonb merges too, so read-modify-replace
 * could clobber a concurrent write).
 */
export const migration099ImapBackfillStamps: DataMigrationDef = {
  id: '099-imap-backfill-stamps',
  description: 'Stamp backfill-window metadata onto pre-fix IMAP channels',
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        id: schema.Integration.id,
        metadata: schema.Integration.metadata,
        lastSuccessfulSync: schema.Integration.lastSuccessfulSync,
      })
      .from(schema.Integration)
      .where(and(eq(schema.Integration.provider, 'imap'), isNull(schema.Integration.deletedAt)))

    const summary = { both: 0, cutoffOnly: 0, skipped: 0 }

    for (const row of rows) {
      const plan = planImapBackfillStamps(row)
      if (plan === 'skip') {
        summary.skipped++
        continue
      }

      const epochIso = new Date().toISOString()
      const patch =
        plan === 'both'
          ? sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object(
              'backfillCutoffAt', ${epochIso}::text,
              'initialBackfillCompletedAt', ${epochIso}::text
            )`
          : sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('backfillCutoffAt', ${epochIso}::text)`

      await db
        .update(schema.Integration)
        .set({ metadata: patch, updatedAt: new Date() })
        .where(eq(schema.Integration.id, row.id))

      if (plan === 'both') summary.both++
      else summary.cutoffOnly++
    }

    logger.info('IMAP backfill stamps complete', summary)
  },
}
