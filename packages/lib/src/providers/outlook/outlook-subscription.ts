// packages/lib/src/providers/outlook/outlook-subscription.ts

import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ProviderRegistryService } from '../provider-registry-service'
import { providerWebhookCallbackUrl } from '../webhook-callback-base'

/**
 * Arm (or re-arm) an Outlook channel's Graph change-notification subscription — the single
 * entry point for turning a channel's push door on, per webhook-push-migration plan §3.2 +
 * Phase 2.3.
 *
 * Steps, in order:
 * 1. Load the `Integration` row and require it to be an active Outlook channel (provider is
 *    `'outlook'`, `enabled`, not soft-deleted). Anything else throws a plain `Error` — this
 *    function has no fallback behavior of its own; callers decide what "arming failed" means
 *    for them.
 * 2. Resolve the runtime provider instance via `ProviderRegistryService`.
 * 3. **Seed the delta cursor only if one is missing.** If `metadata.graphDeltaLink` is absent,
 *    call `provider.syncMessages(args.seedSince ?? new Date())` — this mints a cursor scoped
 *    to `receivedDateTime ge <epoch>`, so the *first* push-triggered sync only ever sees mail
 *    from that point forward. Without this, a brand-new channel's first notification would
 *    start a full unfiltered inbox walk racing the initial backfill — the exact double-pipeline
 *    §3.2 forbids.
 *
 *    If a cursor already EXISTS, it is left untouched. Both re-enable-after-disable and
 *    re-arm-after-reconnect route through this function, and the frozen cursor is precisely
 *    what makes those flows "pause and catch up": the next sync walks the delta from where it
 *    froze and ingests whatever arrived while the channel was off. Re-seeding to `now` here
 *    would silently discard that window's mail.
 * 4. Call `provider.setupWebhook(callbackUrl)` — the provider owns PATCH-or-POST and all
 *    404/409 recovery, and persists the resulting subscription state (including
 *    `Integration.webhookRouteKey`) itself.
 * 5. **Un-fail the channel.** If the row's `syncStatus` is `'FAILED'`, flip it to `'ACTIVE'`.
 *    This is the only place that clears a latched Sync Error card (plan Phase 4.4) — nothing
 *    else resets it, so the first successful arm after a run of failures is what un-sticks the
 *    UI.
 *
 * Deliberately has no try/catch: a failure here is the caller's to interpret. Provisioning
 * falls back to polling; the health job counts consecutive failures toward `syncStatus:
 * 'FAILED'`.
 */
export async function armOutlookSubscription(args: {
  integrationId: string
  organizationId: string
  /** Epoch to seed a missing delta cursor from (defaults to now). Callers stamping
   *  metadata.backfillCutoffAt pass the SAME instant so both doors share one epoch. */
  seedSince?: Date
}): Promise<void> {
  const { integrationId, organizationId, seedSince } = args

  const [row] = await db
    .select({
      id: schema.Integration.id,
      provider: schema.Integration.provider,
      enabled: schema.Integration.enabled,
      deletedAt: schema.Integration.deletedAt,
      metadata: schema.Integration.metadata,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.id, integrationId),
        eq(schema.Integration.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row || row.provider !== 'outlook' || !row.enabled || row.deletedAt) {
    throw new Error(`Integration ${integrationId} is not an active Outlook channel`)
  }

  const provider = await new ProviderRegistryService(organizationId).getProvider(integrationId)

  const metadata = row.metadata as Record<string, unknown> | null
  if (!metadata?.graphDeltaLink) {
    await provider.syncMessages(seedSince ?? new Date())
  }

  await provider.setupWebhook(providerWebhookCallbackUrl('outlook'))

  // First successful arm clears a latched Sync Error card — nothing else does.
  await db
    .update(schema.Integration)
    .set({ syncStatus: 'ACTIVE', updatedAt: new Date() })
    .where(
      and(eq(schema.Integration.id, integrationId), eq(schema.Integration.syncStatus, 'FAILED'))
    )
}
