// packages/lib/src/providers/social/api.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError } from '../../errors'
import type { SocialPlatform } from './types'

const logger = createScopedLogger('social-graph-api')

/**
 * Graph version this client talks. Overridable via `FACEBOOK_GRAPH_API_VERSION`.
 *
 * The per-provider constants this replaces still said `v19.0`, which is past
 * deprecation: Graph silently answers such a call as a current version and hands
 * back `paging.next` links stamped with it (observed live 2026-08-17 — a v19.0
 * request whose continuation links all came back `v25.0`). A version we do not
 * control is a version we cannot reason about, so it is pinned in one place.
 */
const DEFAULT_GRAPH_API_VERSION = 'v26.0'

export function graphApiVersion(): string {
  try {
    return configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || DEFAULT_GRAPH_API_VERSION
  } catch {
    return DEFAULT_GRAPH_API_VERSION
  }
}

/** The error envelope Graph returns on every failure. */
export interface GraphErrorBody {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  error_user_title?: string
  error_user_msg?: string
  fbtrace_id?: string
}

interface GraphResponseEnvelope {
  error?: GraphErrorBody
}

export interface GraphListResponse<T> {
  data?: T[]
  paging?: { next?: string | null; cursors?: { before?: string; after?: string } }
  error?: GraphErrorBody
}

/**
 * A Graph call failed.
 *
 * ONE class rather than a family of `AuxxError` subclasses, because the thing a
 * caller needs to branch on is Meta's `code`/`error_subcode` — and
 * `AuxxErrorDetails` only carries strings, so re-wrapping into
 * `UnauthorizedError`/`RateLimitError` would strip exactly the information that
 * makes the error actionable. `statusCode` is derived instead, so the router
 * mapping still lands on the right HTTP status.
 */
export class GraphApiError extends AuxxError {
  statusCode: number
  readonly code?: number
  readonly subcode?: number
  readonly traceId?: string
  /** HTTP status Graph answered with. `0` for a transport failure. */
  readonly httpStatus: number

  constructor(message: string, body: GraphErrorBody | undefined, httpStatus: number) {
    super(message, {
      graphCode: body?.code === undefined ? undefined : String(body.code),
      graphSubcode: body?.error_subcode === undefined ? undefined : String(body.error_subcode),
      traceId: body?.fbtrace_id,
    })
    this.name = 'GraphApiError'
    this.code = body?.code
    this.subcode = body?.error_subcode
    this.traceId = body?.fbtrace_id
    this.httpStatus = httpStatus
    this.statusCode = deriveStatusCode(body, httpStatus)
  }
}

/**
 * Subcodes that mean the token is dead and only a human reconnect fixes it:
 * 458 app deauthorized, 460 password changed / session invalidated, 463 expired.
 *
 * Kept as data rather than folded into the throw site because the *reaction* —
 * `markCredentialReauth` — belongs to whoever owns the credential, not to the
 * transport.
 */
const REAUTH_SUBCODES = new Set([458, 460, 463])

/** Meta's throttle codes: app-level, user-level, and per-page rate limits. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])

function isReauthBody(body: GraphErrorBody | undefined): boolean {
  if (!body) return false
  if (body.error_subcode && REAUTH_SUBCODES.has(body.error_subcode)) return true
  // 190 is the generic OAuthException for an invalid/expired token.
  return body.code === 190
}

function deriveStatusCode(body: GraphErrorBody | undefined, httpStatus: number): number {
  if (isReauthBody(body)) return 401
  if (body?.code !== undefined && RATE_LIMIT_CODES.has(body.code)) return 429
  if (httpStatus === 0) return 502
  if (httpStatus >= 400 && httpStatus < 500) return httpStatus
  return 502
}

/**
 * True when this failure means "the user must reconnect", not "retry later".
 * The call site that owns the credential turns this into `markCredentialReauth`.
 */
export function isReauthRequired(error: unknown): boolean {
  return error instanceof GraphApiError && error.statusCode === 401
}

/** True when Meta is rate-limiting us (app, page, or per-user throttle). */
export function isRateLimited(error: unknown): boolean {
  return error instanceof GraphApiError && error.statusCode === 429
}

export interface GraphRequestOptions {
  accessToken: string
  method?: 'GET' | 'POST' | 'DELETE'
  /** Query params. `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>
  /** JSON body for POST. */
  body?: Record<string, unknown>
  /** Full URL to call instead of building one — for following `paging.next`. */
  url?: string
}

/**
 * The single place this codebase talks to the Graph API.
 *
 * Every Facebook and Instagram call goes through here so that the version, the
 * error shape, and the token handling are decided once. Before this existed the
 * two providers and the provisioning hook held ~20 hand-rolled `fetch` calls,
 * each with its own version constant, its own `if (!res.ok || data.error)`, and
 * its own idea of what to throw.
 *
 * The access token goes in the `Authorization` header rather than the query
 * string: Graph accepts both, but a query-string token ends up in logs, error
 * messages, and `paging.next` links. The old code logged URLs with
 * `.split('access_token=')[0]` precisely to work around that.
 *
 * @throws {AuxxError} Always an `AuxxError` subclass — `UnauthorizedError` when
 * the token is dead (see {@link isReauthRequired}), `RateLimitError` when Meta
 * is throttling, `GraphApiError` otherwise, all carrying Meta's `code`/`subcode`.
 */
export async function graphRequest<T>(path: string, options: GraphRequestOptions): Promise<T> {
  const { accessToken, method = 'GET', query, body, url } = options

  let target: string
  if (url) {
    target = url
  } else {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value))
    }
    const qs = params.toString()
    const cleanPath = path.startsWith('/') ? path.slice(1) : path
    target = `https://graph.facebook.com/${graphApiVersion()}/${cleanPath}${qs ? `?${qs}` : ''}`
  }

  let response: Response
  try {
    response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    // Transport failure — no Graph envelope to read.
    throw new GraphApiError(
      `Graph request failed: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      0
    )
  }

  let payload: (T & GraphResponseEnvelope) | undefined
  try {
    payload = (await response.json()) as T & GraphResponseEnvelope
  } catch {
    payload = undefined
  }

  if (!response.ok || payload?.error) {
    const graphError = new GraphApiError(
      payload?.error?.error_user_msg ||
        payload?.error?.message ||
        `Graph request failed (${response.status})`,
      payload?.error,
      response.status
    )
    logger.error('Graph API call failed', {
      // Never the full URL: it may carry a token when following a `paging.next` link.
      path: url ? '[paging.next]' : path,
      method,
      status: response.status,
      code: payload?.error?.code,
      subcode: payload?.error?.error_subcode,
      traceId: payload?.error?.fbtrace_id,
      message: graphError.message,
    })
    throw graphError
  }

  if (payload === undefined) {
    throw new GraphApiError('Graph returned an unreadable body', undefined, response.status)
  }
  return payload
}

// --- Named operations -------------------------------------------------------

export interface GraphPage {
  id: string
  name?: string
  access_token?: string
  instagram_business_account?: { id?: string; username?: string }
}

/** `GET /me/accounts` — the Pages this user administers, with page tokens. */
export async function listPages(userAccessToken: string): Promise<GraphPage[]> {
  const result = await graphRequest<GraphListResponse<GraphPage>>('me/accounts', {
    accessToken: userAccessToken,
    query: { fields: 'id,name,access_token,instagram_business_account{id,username}' },
  })
  return result.data ?? []
}

/** `GET /{pageId}?fields=instagram_business_account` — the linked IG account, if any. */
export async function getPageIgAccount(
  pageId: string,
  pageAccessToken: string
): Promise<{ id?: string; username?: string } | null> {
  const result = await graphRequest<GraphPage>(pageId, {
    accessToken: pageAccessToken,
    query: { fields: 'instagram_business_account{id,username}' },
  })
  return result.instagram_business_account ?? null
}

/**
 * Webhook fields each channel subscribes its Page to.
 *
 * Exported so the provisioning hook, the provider's `setupWebhook`, and
 * `recoverChannel`'s re-arm all use the SAME set. A silent re-arm that subscribes
 * a narrower set is how a channel ends up "connected" but deaf to half its events.
 *
 * Both objects subscribe on the **Page** — `/{page-id}/subscribed_apps` — including
 * Instagram, whose events are delivered for the IG account linked to that page.
 *
 * Comments/feed are deliberately absent: post comments are WS10, not yet ingested.
 */
export const SOCIAL_SUBSCRIBED_FIELDS = {
  facebook: 'messages,messaging_postbacks,message_reads',
  instagram: 'messages,messaging_postbacks',
} as const

/** `POST /{pageId}/subscribed_apps` — the social analogue of arming a Gmail watch. */
export async function subscribePageToApp(
  pageId: string,
  pageAccessToken: string,
  subscribedFields: string
): Promise<void> {
  await graphRequest<{ success?: boolean }>(`${pageId}/subscribed_apps`, {
    accessToken: pageAccessToken,
    method: 'POST',
    query: { subscribed_fields: subscribedFields },
  })
}

/** `DELETE /{pageId}/subscribed_apps` — stop delivery for this page. */
export async function unsubscribePageFromApp(
  pageId: string,
  pageAccessToken: string
): Promise<void> {
  await graphRequest<{ success?: boolean }>(`${pageId}/subscribed_apps`, {
    accessToken: pageAccessToken,
    method: 'DELETE',
  })
}

/** Messaging types Meta accepts on a send. */
export type MessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG'

export interface SendMessageArgs {
  /** Page id (Messenger) or IG business account id. */
  pageId: string
  pageAccessToken: string
  recipientId: string
  text: string
  messagingType?: MessagingType
  /** Required when `messagingType` is `MESSAGE_TAG`. */
  tag?: string
}

/**
 * `POST /{pageId}/messages`.
 *
 * Addressed by explicit page id rather than `/me/messages`: with a page token the
 * two resolve the same, but `me` silently follows whatever the token belongs to,
 * which makes a mis-scoped token look like a successful send to the wrong account.
 *
 * @returns the `message_id` (`mid`) Meta assigned — the same id space the webhook
 * echo and the REST sync use, which is what lets `(integrationId, externalId)`
 * dedupe a send across all three doors.
 */
export async function sendMessage(args: SendMessageArgs): Promise<{ messageId?: string }> {
  const { pageId, pageAccessToken, recipientId, text, messagingType = 'RESPONSE', tag } = args

  const result = await graphRequest<{ message_id?: string; recipient_id?: string }>(
    `${pageId}/messages`,
    {
      accessToken: pageAccessToken,
      method: 'POST',
      body: {
        recipient: { id: recipientId },
        messaging_type: messagingType,
        ...(tag ? { tag } : {}),
        message: { text },
      },
    }
  )
  return { messageId: result.message_id }
}

/**
 * The subset of a Meta user-profile node this codebase reads.
 *
 * Every field is optional on purpose. A person who has restricted profile
 * access — or simply never set a display name — is answered with a node that
 * carries the id and nothing else, and that is a legitimate outcome, not an
 * error. Callers build a label out of whatever came back and fall back to the
 * raw PSID/IGSID when nothing did.
 */
export interface GraphUserProfile {
  id?: string
  /** Instagram: the account's display name. */
  name?: string
  /** Messenger: given name. */
  first_name?: string
  /** Messenger: family name. */
  last_name?: string
  /** Instagram: the `@handle`, without the `@`. */
  username?: string
  profile_pic?: string
}

/**
 * Fields requested per platform.
 *
 * **These sets are deliberately narrow and platform-specific, and that is the
 * whole risk in this call.** Graph rejects an entire request with error 100
 * ("nonexisting field") when one requested field is not supported on the node,
 * so asking for the union of both would fail on both. What is encoded here is
 * what Meta documents for each surface:
 *
 * - Messenger's User Profile API on a PSID: `first_name`, `last_name`,
 *   `profile_pic` (plus locale/timezone/gender, which we do not want). It has
 *   NO `name` field.
 * - Instagram's on an IGSID: `name`, `username`, `profile_pic`.
 *
 * Not live-verified against v26 on a real PSID at the time of writing, so the
 * response side is handled defensively: absent fields are normal, and the whole
 * call is non-throwing.
 */
const USER_PROFILE_FIELDS: Record<SocialPlatform, string> = {
  facebook: 'first_name,last_name,profile_pic',
  instagram: 'name,username,profile_pic',
}

/**
 * `GET /{psid|igsid}` — the counterpart's public profile.
 *
 * **The one operation in this module that does not throw.** Every other op here
 * surfaces a `GraphApiError` because its caller is doing something the user
 * asked for and a failure has to be visible. This one runs on the ingest path
 * for a *cosmetic* value: a display name instead of a raw id. Two entirely
 * normal conditions — a person who restricted profile access, and a page whose
 * token has since gone stale — would otherwise turn a delivered message into a
 * failed webhook, and Meta retries a webhook that does not answer 200.
 *
 * Requires `pages_messaging` (Messenger) / `instagram_manage_messages` (IG),
 * both already held by the connected page token.
 *
 * @returns the profile node, or `null` when Graph refused or answered nothing.
 */
export async function getUserProfile(args: {
  platform: SocialPlatform
  /** PSID (Messenger) or IGSID (Instagram Direct). */
  userId: string
  pageAccessToken: string
}): Promise<GraphUserProfile | null> {
  const { platform, userId, pageAccessToken } = args
  try {
    const profile = await graphRequest<GraphUserProfile>(userId, {
      accessToken: pageAccessToken,
      query: { fields: USER_PROFILE_FIELDS[platform] },
    })
    return profile ?? null
  } catch (error) {
    logger.warn('Could not read Meta user profile (ignored)', {
      platform,
      code: error instanceof GraphApiError ? error.code : undefined,
      subcode: error instanceof GraphApiError ? error.subcode : undefined,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export interface GraphConversation {
  id?: string
  updated_time?: string
  snippet?: string
  participants?: { data?: Array<{ id?: string; name?: string; username?: string }> }
}

/** `GET /{pageId}/conversations` — one page of conversations, newest-first. */
export async function listConversations(args: {
  pageId: string
  pageAccessToken: string
  platform: 'messenger' | 'instagram'
  /** Follow a `paging.next` link instead of starting over. */
  nextUrl?: string
  limit?: number
}): Promise<GraphListResponse<GraphConversation>> {
  const { pageId, pageAccessToken, platform, nextUrl, limit } = args
  return graphRequest<GraphListResponse<GraphConversation>>(`${pageId}/conversations`, {
    accessToken: pageAccessToken,
    url: nextUrl,
    query: {
      platform,
      fields:
        platform === 'instagram'
          ? 'id,participants{id,username},updated_time,snippet'
          : 'id,participants{id,name},updated_time,snippet',
      limit,
    },
  })
}

export interface GraphConversationMessage {
  id?: string
  created_time?: string
  from?: { id?: string; name?: string; username?: string }
  to?: { data?: Array<{ id?: string; name?: string; username?: string }> }
  /**
   * The message text. A **scalar string** on this edge — Graph's Message node has
   * no `text`/`mid` subfields, so requesting `message{text,attachments,mid}` (which
   * both providers used to do) is an invalid expansion, not a richer payload.
   */
  message?: string
}

/** `GET /{conversationId}/messages` — one page of messages, newest-first. */
export async function listConversationMessages(args: {
  conversationId: string
  pageAccessToken: string
  nextUrl?: string
  limit?: number
}): Promise<GraphListResponse<GraphConversationMessage>> {
  const { conversationId, pageAccessToken, nextUrl, limit } = args
  return graphRequest<GraphListResponse<GraphConversationMessage>>(`${conversationId}/messages`, {
    accessToken: pageAccessToken,
    url: nextUrl,
    query: { fields: 'id,created_time,from,to,message', limit },
  })
}

/** `GET /debug_token` — validity, scopes and expiry of a token. */
export async function debugToken(
  inputToken: string,
  appAccessToken: string
): Promise<{
  is_valid?: boolean
  expires_at?: number
  scopes?: string[]
  user_id?: string
}> {
  const result = await graphRequest<{
    data?: { is_valid?: boolean; expires_at?: number; scopes?: string[]; user_id?: string }
  }>('debug_token', {
    accessToken: appAccessToken,
    query: { input_token: inputToken },
  })
  return result.data ?? {}
}

/** `DELETE /{userId}/permissions` — revoke this app's access for the user. */
export async function revokeAccess(userId: string, userAccessToken: string): Promise<void> {
  await graphRequest<{ success?: boolean }>(`${userId}/permissions`, {
    accessToken: userAccessToken,
    method: 'DELETE',
  })
}
