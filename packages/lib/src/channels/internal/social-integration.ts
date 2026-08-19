// packages/lib/src/channels/internal/social-integration.ts
// The CHANNEL-side half of a social connect, shared by both phases.
//
// Phase one (the post-connect hook) discovers the grant; phase two (`social-page-selection.ts`)
// finishes a connect the user had to answer a question about. Both write the same Integration
// row and cache the same page list, so the body lives here once — a second copy is how the
// zero-click path and the picker path would silently drift apart.
//
// The Graph calls themselves are NOT here: they belong with the provider, in
// `providers/social/connect-api.ts` beside the rest of the Graph surface. What is here is
// everything that touches OUR tables — the Integration upsert and its route-key conflict
// mapping, the credential's page cache, the credential token resolution — plus the identity
// types that describe a connected channel.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { resolveConnectionForRuntime } from '../../connections/resolve-connection-for-runtime'
import { ConflictError } from '../../errors'
import {
  SOCIAL_SUBSCRIBED_FIELDS,
  subscribePageToApp as subscribePageToAppApi,
} from '../../providers/social/api'

const logger = createScopedLogger('social-integration')

export type SocialProvider = 'facebook' | 'instagram'

/**
 * A page the connecting user administers, trimmed to what a picker needs.
 *
 * Cached on the CREDENTIAL, not the Integration: it describes the OAuth grant (what this token
 * can reach), not one channel.
 *
 * Deliberately does NOT include page access tokens: those live encrypted on the credential, and
 * a plaintext copy in a metadata blob is a credential leak waiting to be logged. Phase two
 * re-fetches instead, which also gives it live validation of the chosen Page.
 */
export interface CachedSocialPage {
  id: string
  name: string
  igBusinessAccountId?: string
  igUsername?: string
}

/** Resolve a credential's stored access token (the Facebook user token during a connect). */
export async function resolveUserTokenForCredential(args: {
  credentialId: string
  organizationId: string
  userId: string
}): Promise<string> {
  const resolved = await resolveConnectionForRuntime({
    connectionId: args.credentialId,
    organizationId: args.organizationId,
    userId: args.userId,
    ensureFresh: true,
  })
  if (resolved.isErr()) {
    throw new Error(`Failed to resolve social channel token: ${resolved.error.message}`)
  }
  const conn = resolved.value.organizationConnection ?? resolved.value.userConnection
  if (!conn?.value) throw new Error('Social credential resolved without an access token')
  return conn.value
}

/** The connected Page (+ optional linked IG account) plus its long-lived page token. */
export interface SocialIdentity {
  pageId: string
  pageName: string
  longLivedPageToken: string
  longLivedUserToken: string
  /**
   * The connecting user's app-scoped id (ASID). Required, not optional: it is the ONLY join key
   * Meta's data-deletion / deauthorize callback gives us, so a channel stored without it can
   * never be matched to a deletion request. Neither phase reaches `upsertSocialIntegration`
   * without one — see `fetchFacebookUserId`.
   */
  facebookUserId: string
  /** Every page this grant can reach — cached for the picker (see CachedSocialPage). */
  availablePages: CachedSocialPage[]
  instagramAccountId?: string
  instagramUsername?: string
}

/** Subscribe the Page to the app's webhook (the social analogue of arming Gmail watch). */
export async function subscribePageToApp(
  provider: SocialProvider,
  pageId: string,
  pageToken: string
): Promise<void> {
  const subscribedFields =
    provider === 'instagram'
      ? SOCIAL_SUBSCRIBED_FIELDS.instagram
      : SOCIAL_SUBSCRIBED_FIELDS.facebook
  try {
    await subscribePageToAppApi(pageId, pageToken, subscribedFields)
    logger.info('Page subscribed to app webhook', { pageId, provider, subscribedFields })
  } catch (error) {
    // Swallowed on purpose: a failed subscription means real-time delivery is off, but the
    // channel is otherwise connected and `recoverChannel` re-arms it. A throw here would abort
    // provisioning after the Integration row already exists.
    logger.error('Error subscribing Page to app webhook — real-time messages may not arrive', {
      pageId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Postgres unique_violation (SQLSTATE 23505) raised by
 * `Integration_provider_webhookRouteKey_key` — the unique partial index on
 * `(provider, webhookRouteKey)` among live rows.
 *
 * Drizzle wraps the raw `pg` error (which carries `.code` / `.constraint`) in a
 * `DrizzleQueryError` and hangs the original off `.cause`, so both spots are checked. The
 * constraint name is checked too: `Integration` carries other unique indexes
 * (`(organizationId, provider, email)`), and only this one means "someone else owns this Page".
 */
function isRouteKeyConflict(error: unknown): boolean {
  const chain = [error, (error as { cause?: unknown })?.cause]
  return chain.some((node) => {
    const e = node as { code?: string; constraint?: string } | undefined
    return e?.code === '23505' && e?.constraint === 'Integration_provider_webhookRouteKey_key'
  })
}

/**
 * The connect-time failure a duplicate Page produces, phrased for the person who just clicked
 * Connect. Reached from the picker dialog now as well as the OAuth popup, which is strictly
 * better copy placement.
 *
 * Before `webhookRouteKey` was adopted the second org connected happily and then split that
 * Page's inbound DMs between two tenants at random — the unique index turns that silent
 * mis-delivery into this error.
 */
function duplicateRouteKeyError(provider: SocialProvider, displayName: string): ConflictError {
  const subject =
    provider === 'instagram'
      ? `The Instagram account “${displayName}”`
      : `The Facebook Page “${displayName}”`
  return new ConflictError(
    `${subject} is already connected to another Auxx organization. A Page can only deliver ` +
      'its messages to one organization — disconnect it there first, then connect it here.'
  )
}

/**
 * Create the Integration row, or relink the credential onto the existing one (reauth / reconnect).
 * Social channels are matched by the Page id (Facebook) or Instagram Business Account id
 * (Instagram) carried in metadata, not by the email column (which stays null).
 */
export async function upsertSocialIntegration(args: {
  organizationId: string
  provider: SocialProvider
  credentialId: string
  identity: SocialIdentity
}): Promise<{ id: string; isNew: boolean; displayName: string }> {
  const { organizationId, provider, credentialId, identity } = args
  const matchId = provider === 'instagram' ? identity.instagramAccountId! : identity.pageId
  const displayName =
    provider === 'instagram' ? (identity.instagramUsername ?? identity.pageName) : identity.pageName

  const metadata: Record<string, unknown> = {
    pageId: identity.pageId,
    pageName: identity.pageName,
    userId: identity.facebookUserId,
    ...(provider === 'instagram' && {
      instagramBusinessAccountId: identity.instagramAccountId,
      instagramUsername: identity.instagramUsername,
    }),
  }

  // Match on the page/IG id inside the jsonb metadata (no clean drizzle json-path filter), so
  // reauth/reconnect relinks the existing row instead of inserting a duplicate.
  const rows = await db
    .select({ id: schema.Integration.id, metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, provider),
        // Disconnect is a SOFT delete. Without this, a reconnect after disconnect relinks the
        // tombstoned row: the connect reports success, the Integration is updated, and the
        // channel never appears anywhere — every list path filters `deletedAt`. Both sibling
        // hooks document this exact failure.
        isNull(schema.Integration.deletedAt)
      )
    )
  const existing =
    rows.find((r) => {
      const m = r.metadata as Record<string, unknown> | null
      const id = provider === 'instagram' ? m?.instagramBusinessAccountId : m?.pageId
      return id === matchId
    }) ?? null

  if (existing) {
    // jsonb MERGE, never replace. `backfillCutoffAt` / `initialBackfillCompletedAt` and any
    // `settings` live in this same blob, and a wholesale `.set({ metadata })` on reconnect would
    // wipe them — reopening a suppression window that has already closed, or dropping the
    // channel's record-creation settings. Same rule `quo-channel.ts` documents at its own upsert.
    const metadataJson = JSON.stringify(metadata)
    try {
      await db
        .update(schema.Integration)
        .set({
          credentialId,
          enabled: true,
          name: displayName,
          // The inbound routing index. Same value as the metadata id above — this is an index,
          // not a migration of truth; the jsonb keys stay and are read for plenty besides
          // routing. Written on relink too, because a revoke nulls the column while leaving the
          // row alive, so a reconnect has to re-claim it.
          webhookRouteKey: matchId,
          metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || ${metadataJson}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, existing.id))
    } catch (error) {
      if (isRouteKeyConflict(error)) throw duplicateRouteKeyError(provider, displayName)
      throw error
    }
    return { id: existing.id, isNew: false, displayName }
  }

  let created: { id: string } | undefined
  try {
    ;[created] = await db
      .insert(schema.Integration)
      .values({
        organizationId,
        provider,
        credentialId,
        enabled: true,
        // Persisted, not just emitted on the `integration:connected` event — this is what every
        // channel surface reads to label the row. Without it FB/IG render as a bare "Facebook
        // Integration" with no page name anywhere.
        name: displayName,
        // The inbound routing index — what both webhook routes resolve a delivery on. Its unique
        // partial index across live rows is what makes "the same Page in two organizations"
        // unrepresentable instead of a silent 50/50 message split.
        webhookRouteKey: matchId,
        // Received-time trigger cutoff, stamped at the connect epoch and ONLY on a first connect
        // (a reconnect must not reopen a window that already closed). Consumed by both providers'
        // `initialize()` via `setBackfillCutoff`, so a history backfill stores messages without
        // firing `message:received` for them.
        metadata: { ...metadata, backfillCutoffAt: new Date().toISOString() } as any,
        updatedAt: new Date(),
      })
      .returning({ id: schema.Integration.id })
  } catch (error) {
    if (isRouteKeyConflict(error)) throw duplicateRouteKeyError(provider, displayName)
    throw error
  }
  return { id: created!.id, isNew: true, displayName }
}

/**
 * Cache the trimmed page list on the credential.
 *
 * jsonb MERGE under a `meta` key so this cannot clobber whatever else the credential's metadata
 * carries (the OAuth bookkeeping the connections layer writes, and the pending-selection marker),
 * and best-effort: a channel that connected fine must not fail provisioning because a convenience
 * cache could not be written.
 */
export async function cacheAvailablePages(
  credentialId: string,
  pages: CachedSocialPage[]
): Promise<void> {
  try {
    const metaJson = JSON.stringify({ meta: { pages, cachedAt: new Date().toISOString() } })
    await db
      .update(schema.Credential)
      .set({
        metadata: sql`COALESCE(${schema.Credential.metadata}, '{}'::jsonb) || ${metaJson}::jsonb`,
      })
      .where(eq(schema.Credential.id, credentialId))
  } catch (error) {
    logger.warn('Failed to cache available pages on the credential', {
      credentialId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
