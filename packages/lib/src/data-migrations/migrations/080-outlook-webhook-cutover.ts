// packages/lib/src/data-migrations/migrations/080-outlook-webhook-cutover.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { armOutlookSubscription } from '../../providers/outlook/outlook-subscription'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-080')

/**
 * Cut existing polling Outlook channels over to Graph webhook push
 * (`plans/outlook/webhook-push-migration.md` Phase 5).
 *
 * There is one live Outlook channel in dev and a small number in production — this is a
 * one-time cutover, not a soak. Per channel, in order:
 *
 * 1. Skip (and log) channels with a poll currently in flight (`syncStage !== 'IDLE'`) or
 *    flagged for reauth — the migration can be re-run later via the superadmin rerun path
 *    once those conditions clear.
 * 2. Stamp BOTH `metadata.backfillCutoffAt` AND `metadata.initialBackfillCompletedAt` to the
 *    same instant. A literal reading of Phase 5 only mentions the cutoff, but polling already
 *    imported this channel's full history, so there is no backfill left to complete — leaving
 *    `initialBackfillCompletedAt` unset would suppress `message:received` for this channel
 *    forever (the ingest-ctx cutoff gate keys off it, plan Phase 2.5). Stamping the pair
 *    closed keeps the cutoff vocabulary explicit on the row without ever opening a
 *    suppression window.
 * 3. `armOutlookSubscription({ ..., seedSince: epoch })` — a channel coming off polling has no
 *    `graphDeltaLink`, so this seeds one scoped to `receivedDateTime ge epoch` (an ~empty
 *    walk) before arming the subscription, per Phase 5.1.
 * 4. Only on a successful arm: flip `syncMode` to `'auto'`. The plan text says `'webhook'`
 *    explicitly, but `resolveEffectiveSyncMode` resolves `'auto'` to `'webhook'` for Outlook
 *    unconditionally — the same vocabulary `provisioning-hook.ts` now writes for a brand-new
 *    connect. Using `'auto'` here keeps one spelling for "webhook, resolved" across connect
 *    and cutover instead of two, and is behaviorally identical.
 *
 * A failed arm leaves `syncMode` untouched (still `'polling'`) — the channel keeps working
 * exactly as before the migration ran. Per-folder `Label.providerCursor` values are never
 * touched by this migration, so a rollback to `'polling'` resumes cleanly from where polling
 * left off.
 *
 * Raw Drizzle metadata merge on purpose (project convention for data migrations, and required
 * here regardless — `outlook-provider.ts`'s own writes are jsonb merges too, so a
 * read-modify-replace here could race and clobber a concurrent subscription write).
 */
export const migration080OutlookWebhookCutover: DataMigrationDef = {
  id: '080-outlook-webhook-cutover',
  description: 'Cut existing polling Outlook channels over to Graph webhook push',
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        syncStage: schema.Integration.syncStage,
        requiresReauth: schema.Credential.requiresReauth,
      })
      .from(schema.Integration)
      .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
      .where(
        and(
          eq(schema.Integration.provider, 'outlook'),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt),
          eq(schema.Integration.syncMode, 'polling')
        )
      )

    const summary = { cutOver: 0, skippedBusy: 0, skippedReauth: 0, failed: 0 }

    for (const row of rows) {
      try {
        if (row.requiresReauth) {
          summary.skippedReauth++
          logger.info('Skipping Outlook webhook cutover — channel requires reauth', {
            integrationId: row.id,
          })
          continue
        }

        if (row.syncStage !== 'IDLE') {
          summary.skippedBusy++
          logger.info('Skipping Outlook webhook cutover — poll in flight, re-run later', {
            integrationId: row.id,
            syncStage: row.syncStage,
          })
          continue
        }

        const epoch = new Date()
        const epochIso = epoch.toISOString()

        await db
          .update(schema.Integration)
          .set({
            metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object(
              'backfillCutoffAt', ${epochIso}::text,
              'initialBackfillCompletedAt', ${epochIso}::text
            )`,
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, row.id))

        await armOutlookSubscription({
          integrationId: row.id,
          organizationId: row.organizationId,
          seedSince: epoch,
        })

        // Only stamp on a successful arm — a failed arm leaves the channel on 'polling',
        // working exactly as before this migration ran (a failed migration is a no-op, not
        // an outage).
        await db
          .update(schema.Integration)
          .set({ syncMode: 'auto', updatedAt: new Date() })
          .where(eq(schema.Integration.id, row.id))

        summary.cutOver++
      } catch (error) {
        summary.failed++
        logger.error('Outlook webhook cutover failed for channel — left on polling', {
          integrationId: row.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('Outlook webhook cutover complete', summary)
  },
}
