// packages/lib/src/providers/openphone/api.ts
// The one place that talks to Quo (formerly OpenPhone) over the wire. Every other file goes
// through these functions — no hand-rolled fetches.
//
// Base is `https://api.quo.com/v1`. The old `api.openphone.co/v3` host does not resolve at all;
// `api.openphone.com/v1` still aliases but is not what we point at.
//
// Auth: `Authorization: <apiKey>` — raw, matching Quo's docs ("does not use a Bearer token").
// Verified live that a `Bearer ` prefix is also accepted, so either form works; we send the
// documented one.

import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { RateLimitError } from '../../errors'
// Leaf imports, not the `rate-limiter` barrel — the barrel drags in the whole
// `UniversalThrottler` cluster (queues, circuit breakers, the config manager) that this
// path has no use for.
import { pacedFetch } from '../../utils/rate-limiter/paced-fetch'
import { hashScopeId, type Quota, resolveQuota } from '../../utils/rate-limiter/quota'
import type {
  QuoConversation,
  QuoCreateMessageWebhookInput,
  QuoPhoneNumber,
  QuoRestMessage,
  QuoSendMessageInput,
  QuoWebhook,
} from './types'

const logger = createScopedLogger('quo-api')

export const QUO_API_BASE = 'https://api.quo.com/v1'

const MAX_RETRIES_ON_429 = 3

/** An error carrying the HTTP status plus whatever message Quo returned. */
export class QuoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message)
    this.name = 'QuoApiError'
  }
}

/**
 * The quota every call in this file draws from. Quo meters per API KEY, not per number, so
 * three channels backfilling concurrently share one budget — and so do three *workers*, which
 * is why this goes through the shared Redis-backed pacer rather than a process-local map.
 *
 * The key is hashed, never stored raw: `saveConnection` still has no `providerKey` dedupe, so
 * two `Credential` rows can hold the same API key. Keying on the key's hash hands that one
 * workspace one budget; keying on `credentialId` would hand it two and 429 itself.
 *
 * The rate comes from `provider-configs.ts` — this file carries no rate constant of its own.
 */
function quotaFor(apiKey: string): Quota {
  return resolveQuota(IntegrationProviderType.openphone, 'apiKey', hashScopeId(apiKey))
}

function buildQuery(query?: QueryValue): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    // Repeated bare keys — `/v1/messages` rejects `participants[]=` and `participants[0]=`
    // in any bracketed form. Callers that need brackets put them in the key themselves.
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
    } else {
      params.append(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

type QueryValue = Record<string, string | number | boolean | string[] | undefined | null>

/** Issue one paced, retry-on-429 request against the Quo API. */
async function quoFetch<T>(
  apiKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  opts: { query?: QueryValue; body?: unknown } = {}
): Promise<T> {
  const url = `${QUO_API_BASE}${path}${buildQuery(opts.query)}`

  // `pacedFetch` reserves a slot on the shared cursor before every attempt and, on a 429,
  // publishes the `Retry-After` back onto that same cursor — so the backoff is observed by
  // every other worker on this API key, not just this process. It does not sleep the
  // `Retry-After` itself: the next reservation already lands past it.
  let response: Response
  try {
    ;({ response } = await pacedFetch(
      quotaFor(apiKey),
      url,
      {
        method,
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      },
      {
        maxRetries: MAX_RETRIES_ON_429,
        onThrottle: ({ attempt, retryAfterMs }) =>
          logger.warn('Quo API rate limited; shared cursor pushed forward', {
            method,
            path,
            retryAfterMs,
            attempt,
          }),
      }
    ))
  } catch (error) {
    // A `RateLimitError` means the shared budget is backed up past the burst ceiling — that
    // is a real rate-limit answer, not a network failure, so it must not be flattened.
    if (error instanceof QuoApiError || error instanceof RateLimitError) throw error
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Quo API network error', { method, path, error: message })
    throw new QuoApiError(`Failed to reach the Quo API: ${message}`, 0)
  }

  // 204 (webhook delete) has no body.
  if (response.status === 204) return undefined as T

  const raw = await response.text()
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : undefined
  } catch {
    parsed = raw
  }

  if (!response.ok) {
    const message = extractErrorMessage(parsed) ?? `HTTP error ${response.status}`
    logger.error('Quo API error', { method, path, status: response.status, message })
    throw new QuoApiError(`Quo API error (${response.status}): ${message}`, response.status, parsed)
  }

  return parsed as T
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body : undefined
  const bag = body as { message?: unknown; error?: unknown }
  if (typeof bag.message === 'string') return bag.message
  if (typeof bag.error === 'string') return bag.error
  if (bag.error && typeof bag.error === 'object') {
    const inner = (bag.error as { message?: unknown }).message
    if (typeof inner === 'string') return inner
  }
  return undefined
}

/** Standard Quo list envelope. `totalItems` is per-page — never use it to terminate a loop. */
interface QuoList<T> {
  data: T[]
  totalItems?: number
  nextPageToken?: string | null
}

/** `GET /v1/phone-numbers` — every number on the workspace this API key belongs to. */
export async function listPhoneNumbers(apiKey: string): Promise<QuoPhoneNumber[]> {
  const result = await quoFetch<QuoList<QuoPhoneNumber>>(apiKey, 'GET', '/phone-numbers')
  return result.data ?? []
}

/**
 * `POST /v1/messages` — send an SMS.
 * `from` is the E.164 number or `PN…` id; `to` accepts 1–10 recipients.
 */
export async function sendMessage(
  apiKey: string,
  input: QuoSendMessageInput
): Promise<QuoRestMessage> {
  const result = await quoFetch<{ data: QuoRestMessage }>(apiKey, 'POST', '/messages', {
    body: input,
  })
  return result.data
}

/**
 * `POST /v1/webhooks/messages` — create a message webhook scoped to specific numbers.
 * The response carries `key`, the HMAC signing secret; Quo only hands it out here.
 */
export async function createMessageWebhook(
  apiKey: string,
  input: QuoCreateMessageWebhookInput
): Promise<QuoWebhook> {
  const result = await quoFetch<{ data: QuoWebhook }>(apiKey, 'POST', '/webhooks/messages', {
    body: input,
  })
  return result.data
}

/**
 * `DELETE /v1/webhooks/{id}` → 204.
 *
 * Note there is deliberately no update call here: `/v1/webhooks/{id}` routes only `GET` and
 * `DELETE`. `PATCH`, `PUT` and `POST` all 404 (`Cannot PATCH /v1/webhooks/…`), and no
 * `/enable`, `/disable` or `/status` sub-route exists either — probed against the live API.
 * Quo webhooks are immutable: to change `url`, `events`, `resourceIds` or `status`, delete and
 * recreate. `setupWebhook` is built around that.
 */
export async function deleteWebhook(apiKey: string, webhookId: string): Promise<void> {
  await quoFetch<void>(apiKey, 'DELETE', `/webhooks/${encodeURIComponent(webhookId)}`)
}

/** `GET /v1/webhooks` — returns each webhook's `key` in plaintext. */
export async function listWebhooks(apiKey: string): Promise<QuoWebhook[]> {
  const result = await quoFetch<QuoList<QuoWebhook>>(apiKey, 'GET', '/webhooks')
  return result.data ?? []
}

/**
 * `GET /v1/conversations` — one page.
 *
 * Scope is the bracketed `phoneNumbers[]=+1888…` (E.164, not the `PN…` id — that is the
 * `/v1/messages` convention). Supports `createdAfter`/`createdBefore`/`updatedAfter`/
 * `updatedBefore`; unknown params are silently ignored rather than rejected.
 *
 * ⚠️ Results are ordered by `createdAt` DESCENDING, **not** by `lastActivityAt`. Never
 * implement "page until older than the watermark" against activity time.
 */
export async function listConversations(
  apiKey: string,
  params: {
    phoneNumber: string
    maxResults?: number
    pageToken?: string
    createdAfter?: string
    createdBefore?: string
    updatedAfter?: string
    updatedBefore?: string
  }
): Promise<QuoList<QuoConversation>> {
  const { phoneNumber, maxResults, ...rest } = params
  // Spread `rest` BEFORE the explicit keys — spreading it after would re-write `maxResults`
  // with its own (possibly undefined) value and silently drop the default.
  return quoFetch<QuoList<QuoConversation>>(apiKey, 'GET', '/conversations', {
    query: { ...rest, 'phoneNumbers[]': phoneNumber, maxResults: maxResults ?? 50 },
  })
}

/**
 * `GET /v1/messages` — one page of messages for an exact participant set.
 *
 * `phoneNumberId` (the `PN…` id, singular) is REQUIRED, and `participants` must be repeated
 * bare keys — every bracketed form is rejected with `"/participants: Expected array"`. The
 * match is exact-set, not OR, so this is one call per conversation with no batching.
 *
 * Messages come back with `text`/`to[]` (see QuoRestMessage) and NEVER carry media.
 */
export async function listMessages(
  apiKey: string,
  params: {
    phoneNumberId: string
    participants: string[]
    maxResults?: number
    pageToken?: string
    createdAfter?: string
    createdBefore?: string
  }
): Promise<QuoList<QuoRestMessage>> {
  return quoFetch<QuoList<QuoRestMessage>>(apiKey, 'GET', '/messages', {
    query: {
      phoneNumberId: params.phoneNumberId,
      participants: params.participants,
      maxResults: params.maxResults ?? 50,
      pageToken: params.pageToken,
      createdAfter: params.createdAfter,
      createdBefore: params.createdBefore,
    },
  })
}
