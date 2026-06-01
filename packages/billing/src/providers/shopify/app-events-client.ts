// packages/billing/src/providers/shopify/app-events-client.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('billing/shopify/app-events')

/**
 * App Events (per-seat usage) billing API. Two pieces:
 *
 *  1. An **app-scoped** client-credentials token (NOT the per-shop Admin token used by
 *     `active-subscription.ts`). One cached token serves every org's seat events — minted
 *     from the app's client_id/client_secret (`SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`, the
 *     same OAuth app credentials), lives 60 min, refreshed early.
 *  2. A billing-event POST to `api.shopify.com/app/{version}/events`. The API is
 *     additive-only and has **permanent** idempotency (a given `idempotency_key` bills at
 *     most once, ever), which is what makes the daily seat drip safe against retries.
 *
 * See plans/billing/v2/14-shopify-per-seat-usage-meter-hack.md §3.1, §5.1.
 */

const APP_EVENTS_VERSION = '2026-04'
const TOKEN_URL = 'https://api.shopify.com/auth/access_token'
const EVENTS_URL = `https://api.shopify.com/app/${APP_EVENTS_VERSION}/events`

/** Refresh the 60-min token this far before expiry so an in-flight POST never races a stale token. */
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * Mints (or returns the cached) app-scoped client-credentials token. Pass `force` to
 * bypass the cache — used to re-mint exactly once after a 401.
 */
async function getAppToken(force = false): Promise<string> {
  const now = Date.now()
  if (!force && cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
    return cachedToken.token
  }

  // The app's client_id/client_secret for the client-credentials grant are the same OAuth
  // app credentials we already store as the Shopify API key/secret.
  const clientId = configService.get<string>('SHOPIFY_API_KEY')
  const clientSecret = configService.get<string>('SHOPIFY_API_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be configured')
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Shopify app token mint failed (${res.status}): ${body}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  }
  return cachedToken.token
}

/** Status of a single seat-day event POST. `duplicate` = already billed (idempotent no-op). */
export type SeatDayEventStatus = 'accepted' | 'duplicate'

export interface SeatDayEvent {
  /** `gid://shopify/Shop/<id>` — the App Events API `shop_id`. */
  shopGid: string
  /** ISO8601 timestamp; must fall inside the shop's current billing cycle. */
  timestamp: string
  /** Permanent idempotency key — `seat_day:<orgId>:<YYYY-MM-DD>`. */
  idempotencyKey: string
  /** Quantity to ADD to the meter — the org's current `PlanSubscription.seats`. */
  value: number
  /** Meter handle configured in the Partner Dashboard. Defaults to `seat_day`. */
  eventHandle?: string
}

function buildBody(event: SeatDayEvent): string {
  return JSON.stringify({
    shop_id: event.shopGid,
    event_handle: event.eventHandle ?? 'seat_day',
    timestamp: event.timestamp,
    idempotency_key: event.idempotencyKey,
    attributes: { value: event.value },
  })
}

async function doPost(token: string, body: string): Promise<Response> {
  return fetch(EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  })
}

/**
 * Posts one billing event to the seat-day meter.
 *
 * The API returns **202 for everything** — there is no synchronous billing-validation
 * error; failures surface only in the Dev Dashboard logs. We rely on permanent idempotency
 * + a daily lookback for correctness (§5.3/§5.4). Status handling:
 *  - 202 → accepted
 *  - 409 → an in-flight duplicate (idempotent) → treat as already-billed
 *  - 401 → token expired → re-mint once and retry
 *  - 429 → rate-limited (500 rps/app) → back off once and retry
 */
export async function postSeatDayEvent(event: SeatDayEvent): Promise<SeatDayEventStatus> {
  const body = buildBody(event)
  let token = await getAppToken()
  let res = await doPost(token, body)

  // Token expired between mint and POST — re-mint once and retry.
  if (res.status === 401) {
    token = await getAppToken(true)
    res = await doPost(token, body)
  }

  // Rate-limited — single short backoff then retry. The daily lookback heals anything
  // still failing, so we don't loop.
  if (res.status === 429) {
    const retryAfterMs = Number(res.headers.get('retry-after')) * 1000 || 1000
    await new Promise((r) => setTimeout(r, retryAfterMs))
    res = await doPost(token, body)
  }

  if (res.status === 202) return 'accepted'
  if (res.status === 409) return 'duplicate'

  const responseBody = await res.text().catch(() => '')
  logger.error('App Events POST failed', {
    status: res.status,
    idempotencyKey: event.idempotencyKey,
    body: responseBody,
  })
  throw new Error(`App Events POST failed (${res.status}): ${responseBody}`)
}
