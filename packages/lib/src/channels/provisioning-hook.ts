// packages/lib/src/channels/provisioning-hook.ts
// Post-connect provisioning for email channels (Gmail / Outlook). The generic OAuth
// callback commits the Credential (tokens), then runs this hook to do the channel-domain
// work that used to live in GoogleOAuthService.handleInitialAuth / OutlookOAuthService
// handleCallback (minus token storage, which the credential layer now owns):
//   fetch account email, discover Outlook aliases, create-or-relink the Integration row,
//   link it to the default inbox, seed sync state, and arm Gmail watch / kick polling.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { Client } from '@microsoft/microsoft-graph-client'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { google } from 'googleapis'
import { onCacheEvent } from '../cache'
import type { PostConnectHook, PostConnectHookContext } from '../connections/post-connect-hooks'
import { resolveConnectionForRuntime } from '../connections/resolve-connection-for-runtime'
import { ConflictError } from '../errors'
import { publisher } from '../events'
import { InboxService } from '../inboxes/inbox-service'
import { GoogleOAuthService } from '../providers/google/google-oauth'
import { assertSharedConnectInbox } from './connect-inbox'
import { withAuthFailuresCleared } from './internal/auth-metadata'
import { provisionPersonalInbox } from './personal-connection'

const logger = createScopedLogger('channel-provisioning-hook')

/** Map the connection provider key to the Integration's runtime provider class. */
const PROVIDER_BY_KEY: Record<string, 'google' | 'outlook'> = {
  gmail: 'google',
  outlookMail: 'outlook',
}

interface ChannelIdentity {
  email: string
  emailAliases?: string[]
}

/** Resolve a fresh access token for the just-committed credential (org-scoped channel def). */
async function resolveAccessToken(
  ctx: PostConnectHookContext
): Promise<{ token: string; expiresAt: Date | null; isCustomClient: boolean }> {
  const resolved = await resolveConnectionForRuntime({
    connectionId: ctx.credentialId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    ensureFresh: true,
  })
  if (resolved.isErr()) {
    throw new Error(`Failed to resolve channel token: ${resolved.error.message}`)
  }
  const conn = resolved.value.organizationConnection ?? resolved.value.userConnection
  if (!conn?.value) {
    throw new Error('Channel credential resolved without an access token')
  }
  return {
    token: conn.value,
    expiresAt: conn.expiresAt ? new Date(conn.expiresAt) : null,
    // A connection that supplied its own OAuth client carries clientId in its fields.
    isCustomClient: !!conn.fields?.clientId,
  }
}

/** Fetch the connected mailbox email via Google userinfo. */
async function fetchGoogleIdentity(token: string): Promise<ChannelIdentity> {
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: token })
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const { data } = await oauth2.userinfo.get()
  if (!data.email) throw new Error('Could not retrieve email address from Google')
  return { email: data.email }
}

/** Fetch the connected mailbox email + smtp aliases via Microsoft Graph. */
async function fetchOutlookIdentity(token: string): Promise<ChannelIdentity> {
  const graph = Client.init({ authProvider: (done) => done(null, token) })
  const profile = await graph.api('/me').select('mail,userPrincipalName').get()
  const email = profile.mail || profile.userPrincipalName
  if (!email) throw new Error('Could not retrieve email address from Microsoft Graph')

  let emailAliases: string[] = []
  try {
    const aliasResponse = await graph.api('/me?$select=proxyAddresses').get()
    const proxyAddresses: string[] = aliasResponse.proxyAddresses ?? []
    emailAliases = proxyAddresses
      .filter((addr: string) => addr.startsWith('smtp:'))
      .map((addr: string) => addr.replace('smtp:', '').toLowerCase())
      .filter(Boolean)
  } catch (error) {
    logger.warn('Failed to discover Outlook aliases', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return { email, emailAliases }
}

/** Shallow-merge a metadata patch into the existing jsonb blob (never an array). */
function mergeMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return { ...base, ...patch }
}

/**
 * Reject a scope-mismatched connect BEFORE `upsertIntegration` writes anything.
 *
 * `upsertIntegration` relinks the live Integration row for `(org, provider, email)` onto the
 * incoming credential and clears its sync breaker. Discovering the conflict only afterwards — via
 * `provisionPersonalInbox` throwing on a mailbox that is already a shared channel — fails the
 * connect for the user but leaves the org's channel running on the connector's PERSONAL token,
 * which `disconnectPersonalChannelsForUser` (it matches on `Credential.userId`) would then
 * soft-delete when that member is offboarded. Any member allowed to personal-connect could take
 * over a shared channel's credential just by picking its address and dismissing the error. So the
 * destination is validated first, against whatever inbox the mailbox is already linked to.
 *
 * Fail closed in both directions: the only personal connect that may proceed against a live row is
 * a reconnect of the connector's OWN personal mailbox, and a shared connect may not re-credential a
 * mailbox someone holds as a personal account.
 */
async function assertConnectScope(args: {
  organizationId: string
  provider: 'google' | 'outlook'
  email: string
  personal: boolean
  userId: string
}): Promise<void> {
  const { organizationId, provider, email, personal, userId } = args

  // Live rows only, matching `upsertIntegration`'s lookup — a soft-deleted row is a
  // disconnected channel and conflicts with nothing.
  const [existing] = await db
    .select({ id: schema.Integration.id })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, provider),
        eq(schema.Integration.email, email),
        isNull(schema.Integration.deletedAt)
      )
    )
    .limit(1)
  if (!existing) return

  const link = await db.query.InboxIntegration.findFirst({
    where: eq(schema.InboxIntegration.integrationId, existing.id),
  })
  // `isPersonal` is def-derived (plan 40 §3.4) — `getInboxById` resolves the instance's
  // actual definition, so this reads the same authority the mail read path does.
  const inbox = link ? await new InboxService(db, organizationId).getInboxById(link.inboxId) : null

  if (personal) {
    if (inbox?.isPersonal && inbox.ownerUserId === userId) return
    if (inbox?.isPersonal) {
      throw new ConflictError(
        "This mailbox is connected as another member's personal account. They must disconnect it first."
      )
    }
    if (!inbox) {
      // A live row with no inbox link: nothing proves its mail was never org-visible, so it
      // cannot be claimed into a private inbox.
      throw new ConflictError(
        'This mailbox is already connected to this organization. Disconnect it first to connect it as a personal account.'
      )
    }
    throw new ConflictError(
      'This mailbox is already connected as a shared channel. Disconnect it first to connect it as a personal account.'
    )
  }

  if (inbox?.isPersonal) {
    throw new ConflictError(
      'This mailbox is connected as a personal account. Its owner must disconnect it first.'
    )
  }
}

/**
 * Create the Integration row, or relink the credential onto the existing one (reauth / reconnect /
 * calendar grant). On relink the metadata patch is MERGED so domain blobs (watch expiration, cached
 * user emails, calendar sync flags) survive.
 *
 * A relink also clears the sync breaker (`syncStatus` / `syncStage` / `throttle*`). The credential
 * is healthy again, so a prior `FAILED` must not stick: it both shows a stale "Sync Error" badge
 * and — for webhook-mode channels, which the polling relaunch job skips — would never recover on
 * its own. Reset to the clean `NOT_SYNCED` / `IDLE` baseline so the next push or poll resumes.
 *
 * The auth-failure block goes with it. `enabled: true` alone would re-open a channel still
 * carrying `metadata.auth.consecutiveFailures` at or above the auto-disable threshold, and the
 * only thing that clears that counter is a successful sync — so the first transient auth error
 * after the re-consent would disable the channel again on its first strike.
 */
async function upsertIntegration(args: {
  organizationId: string
  provider: 'google' | 'outlook'
  credentialId: string
  email: string
  metadataPatch: Record<string, unknown>
}): Promise<{ id: string; isNew: boolean }> {
  const { organizationId, provider, credentialId, email, metadataPatch } = args

  // Live rows only: a disconnected channel is soft-deleted, and reconnecting the same mailbox
  // must INSERT a fresh row (the partial unique index allows it) so it gets the full `isNew`
  // provisioning — relinking the soft-deleted row would skip the backfill and leave `deletedAt`
  // set, i.e. a channel that connects fine but never appears or syncs.
  const [existing] = await db
    .select({ id: schema.Integration.id, metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, provider),
        eq(schema.Integration.email, email),
        isNull(schema.Integration.deletedAt)
      )
    )
    .limit(1)

  if (existing) {
    await db
      .update(schema.Integration)
      .set({
        credentialId,
        email,
        enabled: true,
        metadata: withAuthFailuresCleared(mergeMetadata(existing.metadata, metadataPatch)) as any,
        syncStatus: 'NOT_SYNCED',
        syncStage: 'IDLE',
        syncStageStartedAt: null,
        throttleFailureCount: 0,
        throttleRetryAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.Integration.id, existing.id))
    return { id: existing.id, isNew: false }
  }

  const [created] = await db
    .insert(schema.Integration)
    .values({
      organizationId,
      provider,
      credentialId,
      email,
      enabled: true,
      metadata: metadataPatch as any,
      updatedAt: new Date(),
    })
    .returning({ id: schema.Integration.id })
  if (!created) throw new Error('Integration insert returned no row')
  return { id: created.id, isNew: true }
}

/**
 * Seed sync after a connect.
 * - New integration: arm the Gmail watch / Outlook subscription (webhook mode) and kick the
 *   initial polling backfill — Outlook's push door only covers mail from the arm point on, so
 *   a new channel still needs the backfill for its history.
 * - Reconnect/reauth: only re-arm the watch/subscription (it may have expired); never
 *   re-trigger a full backfill, matching the old handleReauth behavior.
 */
async function seedSync(args: {
  integrationId: string
  organizationId: string
  provider: 'google' | 'outlook'
  isCustomClient: boolean
  isNew: boolean
}): Promise<void> {
  const { integrationId, organizationId, provider, isCustomClient, isNew } = args

  // Force polling for connections that have no usable webhook path:
  //  - Google with a customer's own OAuth app: can't use our shared Pub/Sub topic.
  // Outlook arming is wired below (armOutlookSubscription) — it is left on 'auto' here so it
  // resolves to 'webhook' and takes the branch further down.
  const forcePolling = provider === 'google' && isCustomClient
  if (forcePolling) {
    await db
      .update(schema.Integration)
      .set({ syncMode: 'polling', updatedAt: new Date() })
      .where(eq(schema.Integration.id, integrationId))
  }

  const { resolveEffectiveSyncMode } = await import('../providers/sync-mode-resolver')
  const effectiveMode = resolveEffectiveSyncMode({
    syncMode: forcePolling ? 'polling' : 'auto',
    provider,
  })

  if (effectiveMode === 'webhook' && provider === 'google') {
    try {
      await GoogleOAuthService.setupPushNotifications(integrationId)
      return
    } catch (error) {
      // Watch arming can fail for infra reasons outside the user's control (e.g. the
      // Pub/Sub topic not granting gmail-api-push publisher). The channel must still
      // work, so stamp it to polling — 'auto' would resolve back to webhook and the
      // scanner would skip it — and fall through to the polling pipeline.
      logger.warn('Gmail watch setup failed — falling back to polling', {
        integrationId,
        error: error instanceof Error ? error.message : String(error),
      })
      await db
        .update(schema.Integration)
        .set({ syncMode: 'polling', updatedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))
    }
  }

  if (effectiveMode === 'webhook' && provider === 'outlook') {
    const { armOutlookSubscription } = await import('../providers/outlook/outlook-subscription')
    try {
      const connectEpoch = new Date()
      if (isNew) {
        // Stamp the received-time trigger cutoff BEFORE seeding, with the SAME epoch the
        // cursor is seeded from — history stays silent during the backfill, overlap mail
        // fires exactly once (webhook-push-migration plan Phase 2.5). jsonb MERGE, not replace.
        await db
          .update(schema.Integration)
          .set({
            metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('backfillCutoffAt', ${connectEpoch.toISOString()}::text)`,
            updatedAt: connectEpoch,
          })
          .where(eq(schema.Integration.id, integrationId))
      }
      await armOutlookSubscription({ integrationId, organizationId, seedSince: connectEpoch })
      // A previous arm failure may have stamped syncMode 'polling'; a successful arm
      // returns the row to 'auto' (resolves to webhook) so the polling scanner skips it —
      // otherwise poll + push would run the double pipeline §3.2 forbids.
      await db
        .update(schema.Integration)
        .set({ syncMode: 'auto', updatedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))
      // Deliberately NO return: a new channel still needs its history — fall through to
      // the isNew backfill kick below. Reconnects exit via the !isNew return.
    } catch (error) {
      logger.warn('Outlook subscription arming failed — falling back to polling', {
        integrationId,
        error: error instanceof Error ? error.message : String(error),
      })
      // 'polling', NOT 'auto' — auto re-resolves to webhook and the polling scanner
      // would skip the row forever (same trick as the Gmail branch above).
      await db
        .update(schema.Integration)
        .set({ syncMode: 'polling', updatedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))
    }
  }

  // Reconnect on a polling channel needs no backfill re-kick — the existing sync state stands.
  if (!isNew) return

  // Initial polling pipeline — imports history for a new channel regardless of sync mode:
  // Outlook is armed for push above but still backfills; Google with a custom client or on
  // polling mode has no other way to get its history.
  await db
    .update(schema.Integration)
    .set({ syncStage: 'MESSAGE_LIST_FETCH_PENDING', updatedAt: new Date() })
    .where(eq(schema.Integration.id, integrationId))

  const { getQueue, Queues } = await import('../jobs/queues')
  const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)
  await pollingSyncQueue.add(
    'messageListFetchJob',
    { integrationId, organizationId, provider },
    {
      jobId: `poll-list-fetch-${integrationId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    }
  )
}

/** Enable calendar sync on the just-(re)connected Google integration + arm recording. */
async function applyCalendarGrant(integrationId: string, organizationId: string): Promise<void> {
  const [row] = await db
    .select({ metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)

  await db
    .update(schema.Integration)
    .set({
      metadata: mergeMetadata(row?.metadata, {
        calendarSyncEnabled: true,
        calendarSyncToken: null,
      }) as any,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, integrationId))

  const { updateOrganizationSetting } = await import('../settings/settings-service')
  await updateOrganizationSetting({
    organizationId,
    key: 'recording.enabled',
    value: true,
  })
}

/** The channel post-connect hook — handles `gmail` and `outlookMail`. */
export const channelProvisioningHook: PostConnectHook = {
  providerKeys: ['gmail', 'outlookMail'],
  async run(ctx: PostConnectHookContext): Promise<void> {
    const provider = PROVIDER_BY_KEY[ctx.providerKey]
    if (!provider) {
      logger.warn('No channel provider mapping for key', { providerKey: ctx.providerKey })
      return
    }

    const { token, isCustomClient } = await resolveAccessToken(ctx)
    const identity =
      provider === 'google' ? await fetchGoogleIdentity(token) : await fetchOutlookIdentity(token)

    const metadataPatch: Record<string, unknown> = { email: identity.email }
    if (identity.emailAliases?.length) metadataPatch.emailAliases = identity.emailAliases

    // Scope check BEFORE the first write — see `assertConnectScope`. The destination guards in
    // `provisionPersonalInbox` / `assertSharedConnectInbox` stay as defense in depth.
    await assertConnectScope({
      organizationId: ctx.organizationId,
      provider,
      email: identity.email,
      personal: !!ctx.personal,
      userId: ctx.userId,
    })

    const integration = await upsertIntegration({
      organizationId: ctx.organizationId,
      provider,
      credentialId: ctx.credentialId,
      email: identity.email,
      metadataPatch,
    })

    if (ctx.personal) {
      // Personal account (§11): dedicated restricted inbox owned by the
      // connector; the chosen `inboxId` (if any) is ignored — provisioning owns
      // the destination.
      await provisionPersonalInbox({
        organizationId: ctx.organizationId,
        ownerUserId: ctx.userId,
        integrationId: integration.id,
        email: identity.email,
      })
    } else {
      // Shared connect (channels v2): the destination inbox is chosen up-front in
      // the UI and forwarded as `pc_inboxId` → `ctx.extra.inboxId`. A reconnect of
      // an already-linked integration keeps its link and ignores the param; a new
      // (or legacy unlinked) integration REQUIRES a validated shared inbox. Linked
      // BEFORE seedSync so the first sync lands in the right-visibility inbox.
      const existingLink = await db.query.InboxIntegration.findFirst({
        where: eq(schema.InboxIntegration.integrationId, integration.id),
      })
      if (!existingLink) {
        const recordId = await assertSharedConnectInbox(
          db,
          ctx.organizationId,
          ctx.extra?.inboxId as string | undefined
        )
        const inboxService = new InboxService(db, ctx.organizationId, ctx.userId)
        await inboxService.addIntegration(recordId, integration.id)
      }
    }

    await seedSync({
      integrationId: integration.id,
      organizationId: ctx.organizationId,
      provider,
      isCustomClient,
      isNew: integration.isNew,
    })

    // Incremental calendar-scope grant (recording feature) — flagged via OAuth post-connect context.
    if (provider === 'google' && ctx.extra?.calendarGrant) {
      await applyCalendarGrant(integration.id, ctx.organizationId)
    }

    await onCacheEvent('channel.connected', { orgId: ctx.organizationId })

    await publisher.publishLater({
      type: 'integration:connected',
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider,
        identifier: identity.email,
        integrationId: integration.id,
      },
    })

    logger.info('Channel provisioned', {
      integrationId: integration.id,
      provider,
      email: identity.email,
    })
  },
}
