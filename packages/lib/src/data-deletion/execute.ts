// packages/lib/src/data-deletion/execute.ts
//
// The teardown. Runs asynchronously from a BullMQ job, because it makes several
// Graph calls per channel and doing it inline would put Meta's callback timeout
// in the path of Facebook's own API latency.
//
// ⚠️ This file must NEVER call `channels/disconnect.ts`'s `disconnect()`. That
// function HARD-DELETES every `Thread` and `Message` for the channel plus their
// attachments and S3 objects (lines 100-105). The conversations belong to the
// BUSINESS whose Page it is — Auxx.ai is the processor, the business is the
// controller — and one admin removing the app from their personal Facebook
// settings does not carry a right to erase their employer's customer-support
// records. `revokeAccess` + a `deletedAt` stamp is the whole correct teardown.

import { type Database, type DataDeletionRequestEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import type { DataDeletionStatus, MetaDataDeletionKind } from './client'
import { guard } from './guard'
import { notifyOrgOfMetaTeardown } from './notify'
import { getDeletionRequestById } from './read'
import { type ResolvedMetaChannel, resolveMetaChannels } from './resolve'

const logger = createScopedLogger('data-deletion')

export interface DeletionRequestOutcome {
  requestId: string
  status: DataDeletionStatus
  organizationIds: string[]
  integrationIds: string[]
}

/** Revoke a channel's Meta tokens. Failure is EXPECTED, not an error state. */
async function revokeMetaChannel(channel: ResolvedMetaChannel): Promise<void> {
  try {
    // Lazy import: the OAuth services sit in a module graph that imports back
    // into channels/credentials, and a static import here would close a cycle.
    if (channel.provider === 'instagram') {
      const { InstagramOAuthService } = await import('../providers/instagram/instagram-oauth')
      await InstagramOAuthService.getInstance().revokeAccess(channel.integrationId)
    } else {
      const { FacebookOAuthService } = await import('../providers/facebook/facebook-oauth')
      await FacebookOAuthService.getInstance().revokeAccess(channel.integrationId)
    }
  } catch (error) {
    // The callback often arrives AFTER the person already removed the app, so
    // the Graph revoke 400s. That is the normal case, not a failure: the local
    // credentials still get deleted and the channel still gets soft-deleted.
    logger.warn('Meta revokeAccess failed during deletion teardown; continuing', {
      error,
      integrationId: channel.integrationId,
      provider: channel.provider,
    })
  }
}

/** `data_deletion`: revoke, then soft-delete. Threads and messages are untouched. */
async function tearDownChannel(db: Database, channel: ResolvedMetaChannel): Promise<void> {
  await revokeMetaChannel(channel)
  await db
    .update(schema.Integration)
    .set({ enabled: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.Integration.id, channel.integrationId))
}

/**
 * `deauthorize`: pause only. Credentials and sync cursors are KEPT deliberately
 * — disable is pause-and-catch-up, and collapsing this into the deletion path
 * would cost the user a reconnect-without-re-consent and throw away sync
 * cursors for no compliance gain.
 */
async function pauseChannel(db: Database, channel: ResolvedMetaChannel): Promise<void> {
  await db
    .update(schema.Integration)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(schema.Integration.id, channel.integrationId))
}

async function markRequest(
  db: Database,
  requestId: string,
  patch: Partial<{
    status: DataDeletionStatus
    organizationIds: string[]
    integrationIds: string[]
    completedAt: Date | null
    error: string | null
  }>
): Promise<void> {
  await db
    .update(schema.DataDeletionRequest)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.DataDeletionRequest.id, requestId))
}

/** Run the Meta half: resolve the whole set first, then act on the snapshot. */
async function executeMetaRequest(
  db: Database,
  request: DataDeletionRequestEntity,
  kind: MetaDataDeletionKind
): Promise<{ organizationIds: string[]; integrationIds: string[] }> {
  // ⚠️ Snapshot BEFORE tearing anything down: `revokeAccess` nulls
  // `Integration.metadata`, erasing the `userId` this lookup keys on. Resolving
  // inside the loop would silently leave the linked Instagram channel connected
  // on a token we just told Meta we deleted.
  const resolved = await resolveMetaChannels(db, request.externalId)
  if (resolved.isErr()) throw resolved.error
  const channels = resolved.value

  if (channels.length === 0) {
    // Normal: a Meta retry, an already-disconnected channel, or a login that
    // never connected one. Complete the request rather than erroring.
    logger.info('Deletion request resolved zero Meta channels; completing', {
      requestId: request.id,
      kind,
    })
    return { organizationIds: [], integrationIds: [] }
  }

  for (const channel of channels) {
    if (kind === 'data_deletion') {
      await tearDownChannel(db, channel)
    } else {
      await pauseChannel(db, channel)
    }
    await notifyOrgOfMetaTeardown(db, {
      organizationId: channel.organizationId,
      channelName: channel.name,
      platform: channel.provider,
      kind,
    })
  }

  return {
    organizationIds: [...new Set(channels.map((c) => c.organizationId))],
    integrationIds: channels.map((c) => c.integrationId),
  }
}

/**
 * Execute one recorded deletion/deauthorize request end to end and stamp the
 * audit row with what actually happened.
 *
 * Branching by `kind`:
 * - `data_deletion` — per resolved channel: `revokeAccess`, then
 *   `Integration.deletedAt = now()`. Notify + email. History untouched.
 * - `deauthorize` — per resolved channel: `Integration.enabled = false` ONLY.
 *   Credentials and sync cursors are kept. Notify + email.
 * - `customer_redact` / `shop_redact` / `customer_data_request` — transport
 *   only for now; the row is parked in `processing` so the gap is VISIBLE
 *   rather than hidden behind a `logger.info`.
 *
 * Resolving zero channels is a successful outcome, not an error.
 */
export async function executeDeletionRequest(
  db: Database,
  requestId: string
): Promise<Result<DeletionRequestOutcome, Error>> {
  return guard(
    async () => {
      const loaded = await getDeletionRequestById(db, requestId)
      if (loaded.isErr()) throw loaded.error
      const request = loaded.value
      if (!request) throw new NotFoundError('Deletion request not found')

      if (request.status === 'completed') {
        return {
          requestId,
          status: request.status,
          organizationIds: request.organizationIds ?? [],
          integrationIds: request.integrationIds ?? [],
        }
      }

      await markRequest(db, requestId, { status: 'processing', error: null })

      try {
        if (request.kind === 'data_deletion' || request.kind === 'deauthorize') {
          const { organizationIds, integrationIds } = await executeMetaRequest(
            db,
            request,
            request.kind
          )
          await markRequest(db, requestId, {
            status: 'completed',
            organizationIds,
            integrationIds,
            completedAt: new Date(),
            error: null,
          })
          return { requestId, status: 'completed' as const, organizationIds, integrationIds }
        }

        // TODO(shopify-redact): implement the three Shopify compliance bodies —
        // `customer_data_request` compiles and mails the merchant the data we
        // hold for that customer, `customer_redact` anonymises that customer's
        // PII in the sync tables and workflow-execution node outputs, and
        // `shop_redact` deletes the shop's synced data plus its connection.
        // Each needs an inventory of every table holding Shopify PII, which is
        // a separate piece of work (plan §6). The row deliberately stays in
        // `processing` — NOT `completed` — so an auditor sees an outstanding
        // obligation instead of a false claim that we handled it.
        logger.warn('Shopify compliance request recorded but not yet redacted', {
          requestId,
          kind: request.kind,
          externalId: request.externalId,
        })
        return {
          requestId,
          status: 'processing' as const,
          organizationIds: request.organizationIds ?? [],
          integrationIds: request.integrationIds ?? [],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await markRequest(db, requestId, { status: 'failed', error: message })
        throw error
      }
    },
    'Failed to execute deletion request',
    { requestId }
  )
}
