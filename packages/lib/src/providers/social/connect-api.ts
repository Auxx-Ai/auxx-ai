// packages/lib/src/providers/social/connect-api.ts
// The Graph calls a CONNECT makes, before there is a channel: exchange the short-lived user
// token, resolve the connecting user's app-scoped id, list their Pages, probe a Page's linked
// Instagram account.
//
// Sits beside `api.ts` rather than inside it, deliberately and temporarily. `api.ts` routes
// everything through `graphRequest`, which throws `GraphApiError` (an `AuxxError` carrying
// `code`/`error_subcode`) and never logs a token-bearing URL — it is the better implementation,
// and `listPages` / `getPageIgAccount` here are near-duplicates of the two reads below.
//
// ⚠️ Consolidating onto them CHANGES USER-VISIBLE ERROR STRINGS on the connect path, which is the
// exact path a Meta App Review reviewer exercises. These bodies were moved here verbatim from the
// provisioning hook and their message text must stay byte-identical until that consolidation is
// done as its own change. See plans/channels/facebook-page-picker.md §7.

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { graphApiVersion } from './api'

const logger = createScopedLogger('social-connect-api')

/** A Page from `/me/accounts`, with the page token the connect needs. */
export interface FacebookPage {
  id: string
  name: string
  access_token: string
  /** Expanded in the same `/me/accounts` call — one extra field, no extra request. */
  instagram_business_account?: { id?: string; username?: string }
}

export interface InstagramAccount {
  id: string
  username: string
}

/** Platform Facebook app client (v1 uses the platform app only — no per-org BYO client). */
function facebookClient(): { clientId: string; clientSecret: string } {
  const clientId = configService.get<string>('FACEBOOK_APP_ID') || ''
  const clientSecret = configService.get<string>('FACEBOOK_APP_SECRET') || ''
  if (!clientId || !clientSecret) {
    throw new Error(
      'Facebook app credentials (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET) not configured'
    )
  }
  return { clientId, clientSecret }
}

/**
 * Exchange a short-lived token for a long-lived one (`fb_exchange_token`).
 *
 * Returns the INPUT token on failure rather than throwing: a connect that cannot upgrade its
 * token still works, just for an hour instead of ~60 days, and failing the whole connect over a
 * lifetime extension would be the worse trade.
 */
export async function exchangeForLongLived(shortToken: string): Promise<string> {
  const { clientId, clientSecret } = facebookClient()
  const url = `https://graph.facebook.com/${graphApiVersion()}/oauth/access_token`
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortToken,
  })
  try {
    const res = await fetch(`${url}?${params.toString()}`)
    const data = await res.json()
    if (!res.ok || !data.access_token) {
      logger.warn('Long-lived token exchange failed; using short-lived token', {
        error: data.error?.message,
      })
      return shortToken
    }
    return data.access_token as string
  } catch (error) {
    logger.warn('Long-lived token exchange errored; using short-lived token', {
      error: error instanceof Error ? error.message : String(error),
    })
    return shortToken
  }
}

/**
 * The connecting user's app-scoped id (ASID) — `GET /me?fields=id`.
 *
 * Throws rather than returning undefined. Meta's data-deletion and deauthorize callbacks POST a
 * `signed_request` whose payload carries `user_id` and nothing else — no page id, no email, no
 * org — so `Integration.metadata.userId` is the only thing that can resolve a callback to a
 * channel. Swallowing a transient Graph failure here used to provision a channel with no
 * `userId`, permanently invisible to that callback: we would hand Meta a confirmation code while
 * the user's tokens sat untouched in `Credential`. A retryable connect error is the far better
 * failure, so this is fatal to the connect.
 */
export async function fetchFacebookUserId(token: string): Promise<string> {
  let data: { id?: string; error?: { message?: string } } = {}
  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphApiVersion()}/me?fields=id&access_token=${token}`
    )
    data = await res.json()
  } catch (error) {
    data = { error: { message: error instanceof Error ? error.message : String(error) } }
  }
  if (!data?.id) {
    throw new Error(
      `Could not retrieve your Facebook account: ${data?.error?.message ?? 'ensure permissions were granted'}. Please try connecting again.`
    )
  }
  return data.id
}

/** Pages the user manages, each with its own page access token. */
export async function fetchUserPages(token: string): Promise<FacebookPage[]> {
  const url = `https://graph.facebook.com/${graphApiVersion()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${token}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || !Array.isArray(data.data)) {
    throw new Error(
      `Could not retrieve Facebook Pages: ${data.error?.message ?? 'ensure permissions were granted'}`
    )
  }
  return data.data
}

/**
 * The Instagram Business Account linked to a Page, if any — the per-page probe.
 *
 * Only reached when `/me/accounts` did not already expand the field (it asks for
 * `instagram_business_account{id,username}` in the same request), so this is the fallback, not
 * the primary read. Failures are logged rather than swallowed silently: a null here is
 * indistinguishable from "no linked account", and that ambiguity is exactly what produced a
 * misleading "link the account" error.
 */
export async function fetchInstagramAccount(
  pageId: string,
  pageToken: string
): Promise<InstagramAccount | null> {
  try {
    const url = `https://graph.facebook.com/${graphApiVersion()}/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageToken}`
    const res = await fetch(url)
    const data = await res.json()
    if (res.ok && data.instagram_business_account?.id) {
      return {
        id: data.instagram_business_account.id,
        username: data.instagram_business_account.username,
      }
    }
    if (!res.ok || data.error) {
      logger.warn('Could not read instagram_business_account for a Page', {
        pageId,
        status: res.status,
        code: data?.error?.code,
        subcode: data?.error?.error_subcode,
        error: data?.error?.message,
      })
    }
    return null
  } catch (error) {
    logger.warn('instagram_business_account probe errored', {
      pageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
