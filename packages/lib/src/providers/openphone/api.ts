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

import { createScopedLogger } from '@auxx/logger'
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

/**
 * Quo's documented ceiling is 10 requests/second per API key. We pace at 8 to leave headroom;
 * measured latency is ~195ms/request, so a serial caller never reaches this anyway — the pacer
 * matters when a backfill runs a small amount of concurrency.
 */
const MAX_REQUESTS_PER_SECOND = 8
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_REQUESTS_PER_SECOND)
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
 * Per-API-key pacing. The rate limit is per key, not per number, so three channels backfilling
 * concurrently share one budget — keying the pacer on the key is what keeps them from 429ing
 * each other.
 */
const nextSlotByKey = new Map<string, number>()

async function acquireSlot(apiKey: string): Promise<void> {
  const now = Date.now()
  const earliest = nextSlotByKey.get(apiKey) ?? 0
  const slot = Math.max(now, earliest)
  nextSlotByKey.set(apiKey, slot + MIN_INTERVAL_MS)
  const wait = slot - now
  if (wait > 0) await sleep(wait)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: { query?: QueryValue; body?: unknown } = {}
): Promise<T> {
  const url = `${QUO_API_BASE}${path}${buildQuery(opts.query)}`

  for (let attempt = 0; ; attempt++) {
    await acquireSlot(apiKey)

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Quo API network error', { method, path, error: message })
      throw new QuoApiError(`Failed to reach the Quo API: ${message}`, 0)
    }

    if (response.status === 429 && attempt < MAX_RETRIES_ON_429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000
      logger.warn('Quo API rate limited; backing off', { method, path, waitMs, attempt })
      await sleep(waitMs)
      continue
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
      throw new QuoApiError(
        `Quo API error (${response.status}): ${message}`,
        response.status,
        parsed
      )
    }

    return parsed as T
  }
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

/** `PATCH /v1/webhooks/{id}` — used to flip a freshly created webhook from disabled to enabled. */
export async function updateWebhookStatus(
  apiKey: string,
  webhookId: string,
  status: 'enabled' | 'disabled'
): Promise<QuoWebhook> {
  const result = await quoFetch<{ data: QuoWebhook }>(
    apiKey,
    'PATCH',
    `/webhooks/${encodeURIComponent(webhookId)}`,
    { body: { status } }
  )
  return result.data
}

/** `DELETE /v1/webhooks/{id}` → 204. */
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
