// packages/lib/src/channels/social-page-selection.ts
// The two-phase half of the Facebook / Instagram connect: which Page becomes the channel.
//
// `/me/accounts` returns EVERY Page the connecting user administers. Provisioning picked
// `pages[0]` and threw the rest away silently, so a business running several Pages got whichever
// one Graph happened to return first (Graph documents no ordering). This module holds the
// candidate rules, the pending-marker payload, and the phase-two provisioning that the picker
// dialog calls once the user has chosen.
//
// The Page list can only exist AFTER the OAuth hop — there is no token before it — which is why
// this is a post-credential selection and not a form field like Quo's phone-number picker. See
// `connections/pending-selection.ts` for the marker itself.
//
// Style note: this throws `AuxxError` subclasses rather than returning a `Result`, matching
// `quo-channel.ts` (which documents the same exemption) — it sits beside `connect-inbox.ts` and
// both provisioning hooks, all imperative/throwing, and composes with `InboxService`, which
// throws. There are NO permission checks here; the router asserts `channelsManage`.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import {
  clearPendingSelection,
  type PendingConnectSelection,
  readPendingSelection,
} from '../connections/pending-selection'
import { BadRequestError, NotFoundError } from '../errors'
import { publisher } from '../events'
import { InboxService } from '../inboxes/inbox-service'
import { setChannelTokens } from '../providers/channel-token-accessor'
import {
  exchangeForLongLived,
  type FacebookPage,
  fetchFacebookUserId,
  fetchInstagramAccount,
  fetchUserPages,
  type InstagramAccount,
} from '../providers/social/connect-api'
import { assertSharedConnectInboxByRecordId } from './connect-inbox'
import {
  type CachedSocialPage,
  cacheAvailablePages,
  resolveUserTokenForCredential,
  type SocialProvider,
  subscribePageToApp,
  upsertSocialIntegration,
} from './internal/social-integration'

const logger = createScopedLogger('social-page-selection')

/** The `kind` this module answers to. Kept next to the payload it describes. */
export const SOCIAL_PAGE_SELECTION_KIND = 'social-page-selection' as const

/** The Meta body of a `PendingConnectSelection`. Opaque to the connections layer. */
export interface SocialPageSelectionPayload {
  provider: SocialProvider
  /** RecordId of the already-validated destination inbox (from `ctx.extra.inboxId`). */
  inboxRecordId: string
  /**
   * The connecting user's app-scoped id, resolved in phase one. Phase two re-checks it and
   * never provisions without one — it is the only join key Meta's data-deletion callback has.
   */
  facebookUserId: string
  /** Page ids the user may actually pick (Instagram: only those with a linked IG account). */
  candidateIds: string[]
  /** Every page the grant can reach; the picker renders non-candidates disabled. */
  pages: CachedSocialPage[]
}

export type PendingSocialPageSelection = PendingConnectSelection<SocialPageSelectionPayload>

/** The outcome of applying the §candidate rules to one grant. */
export interface SocialCandidateSet {
  /** Pages the user may pick. Always at least one — a grant that reaches none throws. */
  candidates: FacebookPage[]
  /** Resolved IG account per candidate page id (Instagram only; empty for Facebook). */
  instagramByPageId: Map<string, InstagramAccount>
}

/**
 * The multi-cause Instagram failure, thrown when NO page in the grant has a linked account.
 *
 * Deliberately names BOTH causes. An absent `instagram_business_account` does not prove there is
 * no linked account: Graph omits a permission-gated field rather than erroring, so a grant
 * without `instagram_basic` answers exactly like a Page with nothing linked.
 *
 * The wording is asserted verbatim in tests — it is what a Meta reviewer sees on a failed
 * connect, and it must not drift into a paraphrase.
 */
export function noLinkedInstagramError(pages: FacebookPage[]): Error {
  return new Error(
    `No linked Instagram Professional account was found on any of the ${pages.length} managed ` +
      `Facebook Page(s) (${pages.map((page) => page.name).join(', ')}). Either no Instagram ` +
      'Professional account is linked to the Page, or the connection was granted without the ' +
      'instagram_basic permission — in which case Graph hides the link rather than reporting it.'
  )
}

/**
 * Which Pages in this grant may become the channel.
 *
 * **Facebook** — every Page. Zero is the caller's error (thrown before this runs).
 *
 * **Instagram** — only Pages with a resolvable linked IG Business Account, resolved without
 * reintroducing the N-round-trip probe the previous implementation deliberately removed:
 *  1. `/me/accounts` already expands `instagram_business_account{id,username}` — take those.
 *  2. If ANY page came back expanded, that set is the candidates and nothing is probed.
 *  3. Only when NOTHING was expanded is every page probed, because that is precisely the case
 *     where the field is permission-hidden and a probe is the only way to tell "hidden" from
 *     "absent". The probes mostly fail in that case too, degrading into (4) after N cheap calls.
 *  4. Still empty → `noLinkedInstagramError`.
 *
 * Behaviour change worth knowing: the old loop probed pages in order and took the first hit, so
 * an unexpanded `pages[0]` with a linked account beat an expanded `pages[1]`. Under rule 2
 * `pages[1]` wins (or the picker appears). That is a fix, but it does change which Page a
 * single-outcome Instagram connect resolves to in that one narrow case.
 *
 * `probe` is injected so the "only probe when nothing was expanded" rule can be asserted by call
 * count rather than by outcome.
 */
export async function selectSocialCandidates(
  provider: SocialProvider,
  pages: FacebookPage[],
  probe: (
    pageId: string,
    pageToken: string
  ) => Promise<InstagramAccount | null> = fetchInstagramAccount
): Promise<SocialCandidateSet> {
  if (provider === 'facebook') {
    return { candidates: pages, instagramByPageId: new Map() }
  }

  const instagramByPageId = new Map<string, InstagramAccount>()
  const expanded = pages.filter((page) => page.instagram_business_account?.id)

  if (expanded.length > 0) {
    for (const page of expanded) {
      instagramByPageId.set(page.id, {
        id: page.instagram_business_account!.id!,
        username: page.instagram_business_account!.username ?? '',
      })
    }
    return { candidates: expanded, instagramByPageId }
  }

  const probed: FacebookPage[] = []
  for (const page of pages) {
    const account = await probe(page.id, page.access_token)
    if (account) {
      instagramByPageId.set(page.id, account)
      probed.push(page)
    }
  }
  if (probed.length === 0) throw noLinkedInstagramError(pages)
  return { candidates: probed, instagramByPageId }
}

/**
 * The LIVE Integration already bound to this credential, if any.
 *
 * Drives the forced-page rule: a full-OAuth reconnect must relink the Page the channel already
 * has, never show a picker — a mis-click there would move a live channel onto a different Page
 * or collide with the `webhookRouteKey` unique index.
 *
 * `isNull(deletedAt)` is mandatory: disconnect is a SOFT delete, and a tombstoned row must not
 * force a selection, because reconnecting after a disconnect is a fresh connect that legitimately
 * gets the picker.
 */
export async function findLiveSocialIntegrationForCredential(
  credentialId: string,
  provider: SocialProvider
): Promise<{ id: string; pageId: string | null; pageName: string | null } | null> {
  const [row] = await db
    .select({
      id: schema.Integration.id,
      name: schema.Integration.name,
      metadata: schema.Integration.metadata,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.credentialId, credentialId),
        eq(schema.Integration.provider, provider),
        isNull(schema.Integration.deletedAt)
      )
    )
    .limit(1)
  if (!row) return null
  const metadata = row.metadata as { pageId?: string; pageName?: string } | null
  return {
    id: row.id,
    pageId: metadata?.pageId ?? null,
    pageName: metadata?.pageName ?? row.name ?? null,
  }
}

export interface ProvisionSocialChannelInput {
  /** The Credential holding the Facebook user token. */
  credentialId: string
  organizationId: string
  /** The acting user (permission is asserted by the caller, not here). */
  userId: string
  /** The Page id the user picked. Validated against a LIVE fetch, never the cache. */
  pageId: string
  /**
   * Destination inbox. Optional ONLY because the picker path reads it off the pending marker;
   * pass it explicitly and no marker is required. That is what makes "add another Page from this
   * connection" a call site rather than a rewrite.
   */
  inboxRecordId?: string
}

/**
 * Phase two: turn a chosen Page into a channel.
 *
 * Steps, in order:
 *  1. resolve AND re-validate the inbox (argument first, pending marker second — neither →
 *     NotFound). Before any write, so a rejection leaves nothing behind;
 *  2. resolve and long-live the credential's user token (a dead token is the EXPECTED abandonment
 *     path — the pending window deliberately holds a short-lived token, see the hook);
 *  3. re-fetch `/me/accounts` and validate the chosen page against it — a stale cache must never
 *     produce a channel;
 *  4. Instagram only: resolve the IG account for THAT page;
 *  5. exchange for the long-lived PAGE token and upsert the Integration;
 *  6. write the channel tokens, link the inbox, refresh the page cache, clear the marker;
 *  7. arm the webhook, invalidate caches, publish `integration:connected`.
 */
export async function provisionSocialChannel(
  input: ProvisionSocialChannelInput
): Promise<{ integrationId: string }> {
  const { credentialId, organizationId, userId, pageId } = input

  const pending = await readPendingSelection<SocialPageSelectionPayload>(
    credentialId,
    organizationId
  )
  const payload = pending?.payload
  const inboxRecordId = input.inboxRecordId ?? payload?.inboxRecordId
  if (!inboxRecordId) {
    throw new NotFoundError(
      'This connection has no page selection waiting. Connect the channel again.'
    )
  }

  const provider: SocialProvider = payload?.provider ?? 'facebook'

  /**
   * Re-validate the inbox HERE — before any Graph call and long before the Integration exists.
   *
   * This check used to sit next to the inbox link, after `upsertSocialIntegration` had already
   * created the channel and written its tokens. Failing closed that late is not failing closed at
   * all: the rejection left a LIVE Integration holding the Page's `webhookRouteKey` and no inbox
   * link, and because `pendingConnectSelection` marks a Page whose route key is already claimed as
   * "Already connected", the retry showed every option disabled. One bad inbox id therefore burned
   * the Page permanently, from the user's side of the screen.
   *
   * Nothing before the upsert writes anything, so a throw from here leaves the connect exactly as
   * it was — still parked, still finishable.
   */
  const validatedInboxRecordId = await assertSharedConnectInboxByRecordId(
    db,
    organizationId,
    inboxRecordId
  )

  const userToken = await resolveUserTokenForCredential({ credentialId, organizationId, userId })
  const longLivedUserToken = await exchangeForLongLived(userToken)

  // The ASID invariant, preserved structurally: `upsertSocialIntegration` is only ever reached
  // with a non-empty `facebookUserId`, in BOTH phases. Without it the channel is permanently
  // invisible to Meta's data-deletion callback, which joins on it and nothing else.
  const facebookUserId = payload?.facebookUserId || (await fetchFacebookUserId(longLivedUserToken))

  let pages: FacebookPage[]
  try {
    pages = await fetchUserPages(longLivedUserToken)
  } catch (error) {
    // A rejected token here is the pending window expiring, not a bug — say so plainly.
    logger.warn('Could not re-read Pages while finishing a page selection', {
      credentialId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new BadRequestError(
      'Your Facebook session has expired. Connect the channel again to pick a Page.'
    )
  }

  const page = pages.find((candidate) => candidate.id === pageId)
  if (!page) {
    throw new BadRequestError(
      'That Page is no longer available on this Facebook account. Connect again to refresh the list.'
    )
  }

  let instagramAccount: InstagramAccount | null = null
  if (provider === 'instagram') {
    instagramAccount = page.instagram_business_account?.id
      ? {
          id: page.instagram_business_account.id,
          username: page.instagram_business_account.username ?? '',
        }
      : await fetchInstagramAccount(page.id, page.access_token)
    if (!instagramAccount) {
      // Page-specific on purpose: the multi-cause "none anywhere" text belongs to phase one.
      throw new BadRequestError(
        `The Facebook Page “${page.name}” has no linked Instagram Professional account. Link one ` +
          'in Meta Business Suite, or pick a different Page.'
      )
    }
  }

  const longLivedPageToken = await exchangeForLongLived(page.access_token)

  const integration = await upsertSocialIntegration({
    organizationId,
    provider,
    credentialId,
    identity: {
      pageId: page.id,
      pageName: page.name,
      longLivedPageToken,
      longLivedUserToken,
      facebookUserId,
      availablePages: payload?.pages ?? [],
      ...(instagramAccount && {
        instagramAccountId: instagramAccount.id,
        instagramUsername: instagramAccount.username,
      }),
    },
  })

  await setChannelTokens(
    integration.id,
    {
      accessToken: longLivedPageToken,
      refreshToken: longLivedUserToken,
      expiresAt: null,
    },
    { createdById: userId }
  )

  // Validated at the top of this function, not here — see `validatedInboxRecordId`.
  const existingLink = await db.query.InboxIntegration.findFirst({
    where: eq(schema.InboxIntegration.integrationId, integration.id),
  })
  if (!existingLink) {
    await new InboxService(db, organizationId, userId).addIntegration(
      validatedInboxRecordId,
      integration.id
    )
  }

  await cacheAvailablePages(
    credentialId,
    pages.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      igBusinessAccountId: candidate.instagram_business_account?.id,
      igUsername: candidate.instagram_business_account?.username,
    }))
  )

  // Cleared BEFORE the connected publish so nothing downstream can observe a provisioned
  // channel whose credential still claims to be waiting on a choice.
  if (pending) await clearPendingSelection(credentialId, organizationId)

  await subscribePageToApp(provider, page.id, longLivedPageToken)

  await onCacheEvent('channel.connected', { orgId: organizationId })

  await publisher.publishLater({
    type: 'integration:connected',
    data: {
      organizationId,
      userId,
      provider,
      identifier: integration.displayName,
      integrationId: integration.id,
    },
  })

  logger.info('Social channel provisioned from a page selection', {
    integrationId: integration.id,
    provider,
    pageId: page.id,
    isNew: integration.isNew,
  })

  return { integrationId: integration.id }
}
