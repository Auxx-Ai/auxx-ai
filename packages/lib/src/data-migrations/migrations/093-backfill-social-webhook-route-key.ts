// packages/lib/src/data-migrations/migrations/093-backfill-social-webhook-route-key.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-093')

/**
 * Backfill `Integration.webhookRouteKey` for live Facebook / Instagram channels
 * (`plans/channels/facebook-instagram-runtime-fixes.md` WS17).
 *
 * Both social webhook routes used to resolve a delivery with an unindexed jsonb
 * predicate (`metadata ->> 'pageId'` / `metadata ->> 'instagramBusinessAccountId'`)
 * ending in a `.limit(1)` with no ordering — so two orgs on the same Page would
 * silently split inbound DMs between tenants. `webhookRouteKey` exists for exactly
 * this and carries a unique partial index on `(provider, webhookRouteKey)` where
 * `webhookRouteKey IS NOT NULL AND deletedAt IS NULL`, which makes that state
 * unrepresentable.
 *
 * This migration MUST land ahead of the route switch. If the read path adopts the
 * column while every social row still has it null, every inbound DM resolves
 * nothing and ingest goes silently quiet — no error, no log line anyone watches.
 *
 * Raw Drizzle on purpose (data migrations do not use the `ensure*` entity helpers).
 * Idempotent: only rows with the key still NULL are touched, and `metadata` is read
 * but never written — the jsonb keys stay the source of truth for everything else
 * that reads them, this column is only a routing index.
 *
 * `updatedAt` is deliberately left alone: this is an index derived from data the row
 * already carries, not a change to the channel, and bumping it would churn every
 * consumer that watches the channel for real edits.
 *
 * A duplicate Page across two live rows fails the unique index here. That is the correct
 * outcome — it means those two rows really are fighting over the same inbound stream
 * today, and only a human can decide which org keeps it. The loop logs each collision
 * (org + provider + key, not a bare constraint name) and still backfills every other
 * row, then throws so the ledger records the migration as failed rather than reporting
 * a clean pass over a channel that will silently receive nothing.
 */
export const migration093BackfillSocialWebhookRouteKey: DataMigrationDef = {
  id: '093-backfill-social-webhook-route-key',
  description: 'Backfill Integration.webhookRouteKey for live Facebook/Instagram channels',
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        organizationId: schema.Integration.organizationId,
        routeKey: sql<string | null>`
          CASE ${schema.Integration.provider}
            WHEN 'facebook' THEN ${schema.Integration.metadata} ->> 'pageId'
            WHEN 'instagram' THEN ${schema.Integration.metadata} ->> 'instagramBusinessAccountId'
          END
        `.as('routeKey'),
      })
      .from(schema.Integration)
      .where(
        and(
          isNull(schema.Integration.deletedAt),
          isNull(schema.Integration.webhookRouteKey),
          sql`${schema.Integration.provider} IN ('facebook', 'instagram')`
        )
      )

    const summary = { backfilled: 0, skippedNoKey: 0, failed: 0 }

    for (const row of rows) {
      if (!row.routeKey) {
        summary.skippedNoKey++
        logger.warn('Social channel has no routing id in metadata — left unrouted', {
          integrationId: row.id,
          provider: row.provider,
        })
        continue
      }

      try {
        await db
          .update(schema.Integration)
          .set({ webhookRouteKey: row.routeKey })
          .where(eq(schema.Integration.id, row.id))
        summary.backfilled++
      } catch (error) {
        summary.failed++
        logger.error('Failed to backfill webhookRouteKey — another live channel holds this key', {
          integrationId: row.id,
          organizationId: row.organizationId,
          provider: row.provider,
          routeKey: row.routeKey,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('Social webhookRouteKey backfill complete', summary)

    if (summary.failed > 0) {
      throw new Error(
        `${summary.failed} social channel(s) could not claim a webhookRouteKey — another live ` +
          'channel already holds the same Page/Instagram account id. Resolve the duplicate ' +
          '(disconnect the channel that should not own the Page) and re-run this migration.'
      )
    }
  },
}
