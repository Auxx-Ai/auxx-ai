// packages/lib/src/channels/quo-channel.ts
// Provisioning for the Quo (formerly OpenPhone) SMS channel.
//
// THE MODEL: one connection = one Quo WORKSPACE, not one phone number. Quo scopes the API key
// and webhooks at the workspace; only the number itself is a sub-resource. So a single
// Credential holds the API key, and N Integrations hang off it — one per number the user turns
// into a channel. `Integration.credentialId` is a plain FK on a NON-unique index
// (`Integration_credentialId_idx`), and `disconnect` soft-deletes the Integration without
// touching the Credential, so the schema already supports 1:N.
//
// This module is the single implementation shared by two callers:
//   - the post-connect hook (`openphone-provisioning-hook.ts`), which provisions the first
//     number right after `connections.save` commits the Credential; and
//   - `channel.addQuoNumber` (tRPC), which adds a second/third number against the SAME
//     Credential.
//
// Style note: this throws `AuxxError` subclasses rather than returning a `Result`. It sits
// beside `connect-inbox.ts` (`assertSharedConnectInbox`) and both provisioning hooks, all of
// which are imperative/throwing, and it composes with `InboxService`, which throws too. There
// are NO permission checks here — the hook and the router assert `channelsManage`.

import { revealSecrets } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { publisher } from '../events'
import { InboxService } from '../inboxes/inbox-service'
import { FeatureKey, FeaturePermissionService } from '../permissions'
import { listPhoneNumbers, QuoApiError } from '../providers/openphone/api'
import type {
  QuoCachedPhoneNumber,
  QuoCredentialMetadata,
  QuoPhoneNumber,
} from '../providers/openphone/types'
import { assertSharedConnectInbox } from './connect-inbox'
import { countBillableChannels } from './list'

const logger = createScopedLogger('quo-channel')

/**
 * Trim a live `GET /v1/phone-numbers` row to what we cache. `users[]` is dropped (member
 * emails/names we do not need, and the fastest-staling part); `restrictions` is KEPT, because
 * only a number with `restrictions.messaging.US === 'unrestricted'` can send US SMS — the
 * others fail at send time with no signal in our UI.
 */
function toCachedPhoneNumber(number: QuoPhoneNumber): QuoCachedPhoneNumber {
  return {
    id: number.id,
    number: number.number,
    name: number.name ?? null,
    ...(number.restrictions ? { restrictions: number.restrictions } : {}),
  }
}

/** Translate a Quo wire failure into the AuxxError the router/hook should surface. */
function toAuxxError(error: unknown): Error {
  if (error instanceof QuoApiError) {
    if (error.status === 401 || error.status === 403) {
      return new BadRequestError('That API key was rejected by Quo. Check the key and try again.')
    }
    return new BadRequestError(`Quo rejected the request: ${error.message}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Fetch every phone number on the workspace an API key belongs to, trimmed to the cached
 * projection. Used both to validate a pasted key before any Credential exists and as the live
 * fetch inside `provisionQuoChannel`.
 */
export async function listQuoPhoneNumbers(apiKey: string): Promise<QuoCachedPhoneNumber[]> {
  try {
    const numbers = await listPhoneNumbers(apiKey)
    return numbers.map(toCachedPhoneNumber)
  } catch (error) {
    throw toAuxxError(error)
  }
}

/**
 * Read the cached workspace numbers back off `Credential.metadata.quo`.
 *
 * The read counterpart of {@link cachePhoneNumbers} — the "add another number" picker renders
 * from this instead of re-asking for the API key (which would mint a SECOND Credential for the
 * same Quo workspace, the exact thing the workspace-scoped model exists to prevent).
 *
 * Org-scoped on purpose: `credentialId` arrives from the client, so the org predicate is the
 * authorization boundary, not a filter. A credential from another org, a missing row, or a
 * credential saved before this cache existed all read as an EMPTY list — never an error. An
 * empty list is a legitimate "nothing cached yet" state the caller falls back from, and the
 * cache is a picker convenience only: `provisionQuoChannel` still validates the chosen number
 * against a live fetch.
 */
export async function readCachedQuoNumbers(
  credentialId: string,
  organizationId: string
): Promise<{ phoneNumbers: QuoCachedPhoneNumber[]; fetchedAt: string | null }> {
  const [row] = await db
    .select({ metadata: schema.Credential.metadata })
    .from(schema.Credential)
    .where(
      and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      )
    )
    .limit(1)

  const quo = (row?.metadata as { quo?: Partial<QuoCredentialMetadata> } | null)?.quo
  if (!quo || !Array.isArray(quo.phoneNumbers)) return { phoneNumbers: [], fetchedAt: null }
  return { phoneNumbers: quo.phoneNumbers, fetchedAt: quo.fetchedAt ?? null }
}

/** Read the API key out of the Credential's multi-field secret bag (`secrets.fields.apiKey`). */
async function revealApiKey(credentialId: string, organizationId: string): Promise<string> {
  const revealed = await revealSecrets<{ fields?: Record<string, string> }>(
    credentialId,
    organizationId
  )
  const apiKey = revealed.isOk() ? revealed.value.secrets.fields?.apiKey : undefined
  if (!apiKey) {
    throw new NotFoundError('This Quo connection has no API key. Reconnect it and try again.')
  }
  return apiKey
}

/**
 * Cache the workspace's numbers on `Credential.metadata.quo`.
 *
 * Deliberately its OWN key, not `metadata.connectionVariables`: that bag is reserved for
 * user-supplied form values, and `mergeManualConnectionEdit` read-modify-writes it on every
 * manual reconnect — derived provider state living there would look like a field the user
 * forgot to re-supply. The jsonb `||` merge keeps every other top-level key intact.
 *
 * ⚠️ This cache is a PICKER CONVENIENCE, never a routing authority. Message routing resolves
 * against `Integration.metadata.phoneNumberId` (what the webhook route matches on). Nothing in
 * the ingest path may read this list, and channel creation validates the selected number
 * against a live fetch rather than against this cache.
 */
async function cachePhoneNumbers(
  credentialId: string,
  organizationId: string,
  phoneNumbers: QuoCachedPhoneNumber[]
): Promise<void> {
  const quo: QuoCredentialMetadata = { phoneNumbers, fetchedAt: new Date().toISOString() }
  await db
    .update(schema.Credential)
    .set({
      metadata: sql`COALESCE(${schema.Credential.metadata}, '{}'::jsonb) || jsonb_build_object('quo', ${JSON.stringify(quo)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      )
    )
}

/** Enforce the channel feature limit (only a brand-new channel counts). */
async function assertChannelLimit(organizationId: string): Promise<void> {
  const limit = await new FeaturePermissionService(db).getLimit(organizationId, FeatureKey.channels)
  if (typeof limit === 'number' && limit >= 0) {
    const current = await countBillableChannels(db, organizationId)
    if (current >= limit) {
      throw new ForbiddenError(
        `You have reached your channel limit (${limit}). Upgrade your plan to connect more channels.`
      )
    }
  }
}

/**
 * Find the LIVE openphone Integration for this phone number id, if any (jsonb match in memory).
 *
 * Soft-deleted rows are excluded on purpose, matching `upsertIntegration` in
 * `provisioning-hook.ts`: relinking a `deletedAt`-stamped row produces a channel that connects
 * fine but never appears (the channels cache filters `deletedAt`) and never syncs. Reconnecting
 * a disconnected number must INSERT a fresh row — the partial unique index is keyed on
 * `(organizationId, provider, email)` and openphone rows carry a NULL email, so it allows this.
 */
async function findExistingChannel(
  organizationId: string,
  phoneNumberId: string
): Promise<{ id: string; metadata: Record<string, unknown> | null } | null> {
  const rows = await db
    .select({ id: schema.Integration.id, metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, 'openphone'),
        isNull(schema.Integration.deletedAt)
      )
    )
  const match = rows.find(
    (r) => (r.metadata as Record<string, unknown> | null)?.phoneNumberId === phoneNumberId
  )
  if (!match) return null
  return { id: match.id, metadata: (match.metadata as Record<string, unknown> | null) ?? null }
}

/**
 * Arm the Quo message webhook for a freshly provisioned channel.
 *
 * Goes through the generic seam Gmail/Outlook use — `WebhookManagerService.setupWebhook` →
 * `provider.setupWebhook(callbackUrl)` — which also honours the sync-mode gate, so this is a
 * logged no-op until `resolveEffectiveSyncMode` returns `'webhook'` for openphone.
 *
 * Failure degrades gracefully: log and leave the channel connected, matching how email
 * provisioning falls back to polling. A webhook error must never fail the whole connect.
 */
export async function armQuoWebhook(integrationId: string, organizationId: string): Promise<void> {
  try {
    const { ProviderRegistryService } = await import('../providers/provider-registry-service')
    const { WebhookManagerService } = await import('../providers/webhook-manager-service')
    const registry = new ProviderRegistryService(organizationId)
    await new WebhookManagerService(organizationId, registry).setupWebhooks(
      'openphone',
      integrationId
    )
  } catch (error) {
    logger.warn('Quo webhook arming failed — channel stays connected', {
      integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface ProvisionQuoChannelInput {
  /** The Credential holding the workspace API key. */
  credentialId: string
  organizationId: string
  /** The acting user (permission is asserted by the caller, not here). */
  userId: string
  /** The `PN…` id the user picked. Validated against a LIVE fetch, not the cache. */
  phoneNumberId: string
  /** Required for a brand-new channel; ignored when relinking an existing one. */
  inboxId?: string
}

/**
 * Create (or relink) the channel for one Quo phone number on an existing workspace connection.
 *
 * Steps, in order:
 *  1. reveal the API key from the Credential;
 *  2. `GET /v1/phone-numbers` and refresh `Credential.metadata.quo` (so reconnect re-fetches);
 *  3. validate the selected `PN…` against that LIVE fetch — a stale cache entry must never
 *     produce a broken channel;
 *  4. create-or-relink the Integration, copying `{ phoneNumberId, phoneNumber }` from the live
 *     row onto `Integration.metadata` (the routing identity the webhook route resolves against);
 *  5. link the destination inbox (new channels only);
 *  6. arm the webhook, gracefully;
 *  7. invalidate the channel caches and publish `integration:connected`.
 */
export async function provisionQuoChannel(
  input: ProvisionQuoChannelInput
): Promise<{ integrationId: string }> {
  const { credentialId, organizationId, userId, phoneNumberId } = input

  const apiKey = await revealApiKey(credentialId, organizationId)
  const phoneNumbers = await listQuoPhoneNumbers(apiKey)
  await cachePhoneNumbers(credentialId, organizationId, phoneNumbers)

  const selected = phoneNumbers.find((n) => n.id === phoneNumberId)
  if (!selected) {
    throw new BadRequestError(
      `Phone number ${phoneNumberId} is not on this Quo workspace. Refresh the list and pick again.`
    )
  }

  const existing = await findExistingChannel(organizationId, phoneNumberId)
  // Only a brand-new channel counts against the limit; a reconnect relinks in place.
  if (!existing) await assertChannelLimit(organizationId)

  // Inbox-first (channels v2): a new channel REQUIRES a validated shared inbox chosen up-front;
  // a relink keeps its existing link and ignores the param. Resolved BEFORE the Integration
  // write so a missing/invalid inbox never leaves a half-provisioned channel behind.
  const existingLink = existing
    ? await db.query.InboxIntegration.findFirst({
        where: eq(schema.InboxIntegration.integrationId, existing.id),
      })
    : null
  const inboxRecordId = existingLink
    ? null
    : await assertSharedConnectInbox(db, organizationId, input.inboxId)

  // Routing identity — the shape `OpenPhoneProvider` and the webhook route both read.
  const identity = { phoneNumberId: selected.id, phoneNumber: selected.number }
  let integrationId: string

  if (existing) {
    // MERGE, never replace: `settings`, `webhookId` and `backfillCutoffAt` all live in this
    // blob, and a reconnect that overwrote it would silently reset the channel's record-creation
    // mode and re-open the trigger-suppression window.
    await db
      .update(schema.Integration)
      .set({
        credentialId,
        enabled: true,
        metadata: { ...(existing.metadata ?? {}), ...identity } as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.Integration.id, existing.id))
    integrationId = existing.id
  } else {
    const connectEpoch = new Date()
    const [created] = await db
      .insert(schema.Integration)
      .values({
        organizationId,
        provider: 'openphone',
        credentialId,
        enabled: true,
        metadata: {
          ...identity,
          // Channel settings live under `Integration.metadata.settings` — there is no
          // top-level `settings` column (see channels/settings.ts and the ingest read in
          // store-message.ts).
          //
          // `'all'`, not the `'selective'` this hook used to inherit from email. Selective was
          // spam hygiene for mail: an inbound-only stranger gets a Participant and a working
          // thread but NO Contact (ingest/contacts/find-or-create.ts — it only creates when the
          // participant is an outbound recipient or the org has texted them before). On an SMS
          // support line that is backwards; someone texting the business cold is exactly who
          // should get a CRM record.
          //
          // TRADEOFF, accepted: under `'all'`, short codes and alphanumeric sender IDs (`12345`,
          // `AUXX`) fail `isAddressablePhone`, get `systemAttr = null`, and are created with no
          // identifier-keyed dedupe — i.e. every 2FA/marketing sender becomes an un-dedupable
          // contact. Sender filtering (channels/settings.ts excluded senders) is the follow-up
          // mitigation.
          settings: { recordCreation: { mode: 'all' } },
          // Received-time trigger cutoff, stamped at the connect epoch — the same stamp
          // gmail/outlook write in `provisioning-hook.ts`, consumed via `ingest/context.ts` +
          // `store-message.ts` to suppress `message:received` for pre-cutoff messages. Without
          // it the Phase 6 backfill mass-fires workflows, AI classification, notifications and
          // contact creation for every historical conversation at once.
          backfillCutoffAt: connectEpoch.toISOString(),
        },
        updatedAt: connectEpoch,
      })
      .returning({ id: schema.Integration.id })
    if (!created) throw new Error('Quo channel insert returned no row')
    integrationId = created.id
  }

  if (inboxRecordId) {
    await new InboxService(db, organizationId, userId).addIntegration(inboxRecordId, integrationId)
  }

  // After the Integration row commits and the inbox link lands, before the connected publish.
  await armQuoWebhook(integrationId, organizationId)

  await onCacheEvent('channel.connected', { orgId: organizationId })

  await publisher.publishLater({
    type: 'integration:connected',
    data: {
      organizationId,
      userId,
      provider: 'openphone',
      identifier: selected.number,
      integrationId,
    },
  })

  logger.info('Quo channel provisioned', {
    integrationId,
    phoneNumberId: selected.id,
    isNew: !existing,
  })

  return { integrationId }
}
