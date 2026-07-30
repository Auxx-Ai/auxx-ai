// @auxx/lib/realtime/client/adapters/batch-channel-authorizer.ts

/**
 * Coalescing channel authorizer for pusher-js (plan v3/05).
 *
 * `pusher-js` authorizes ONE channel per HTTP request, always — there is no
 * batching in its `ajax` transport and no option that adds it. A page load that
 * subscribes ~36 per-def record channels (plan v3/03 §8.1) therefore costs ~40
 * `POST /api/pusher/auth`, each paying its own `auth.api.getSession`. The ACL
 * itself is cheap (a cached capability blob + map math); the session lookup is
 * the cost, and it is paid once per channel for one answer.
 *
 * The only seam the library offers is `channelAuthorization.customHandler` — a
 * per-channel callback invoked instead of its own AJAX, whose TIMING we own. So
 * the fix is forced into this shape: buffer the per-channel callbacks for a
 * short window, send one request, fan the results back out.
 *
 * Deliberately free of any `pusher-js` import: the library types below are
 * mirrored structurally so this module is unit-testable without a Pusher
 * instance, a socket, or a DOM.
 */

/** Mirror of pusher-js `ChannelAuthorizationData`. */
export interface ChannelAuthorizationData {
  auth: string
  channel_data?: string
}

/** Mirror of pusher-js `ChannelAuthorizationRequestParams`. */
export interface ChannelAuthorizationRequestParams {
  socketId: string
  channelName: string
}

/** Mirror of pusher-js `ChannelAuthorizationCallback`. */
export type ChannelAuthorizationCallback = (
  error: Error | null,
  authData: ChannelAuthorizationData | null
) => void

/** Mirror of pusher-js `ChannelAuthorizationHandler`. */
export type ChannelAuthorizationHandler = (
  params: ChannelAuthorizationRequestParams,
  callback: ChannelAuthorizationCallback
) => void

/** Wire shape of the batch endpoint's response body. */
export interface BatchAuthResponseBody {
  results: Record<string, ChannelAuthorizationData | null>
}

export interface BatchAuthorizerConfig {
  /** Batch endpoint, e.g. `/api/pusher/auth/batch`. */
  endpoint: string
  /** Coalesce window in ms. */
  windowMs?: number
  /** Hard cap per request; the group flushes early once reached. */
  maxBatch?: number
  /** Injected for tests. Resolved lazily so a test can install a stub late. */
  fetchImpl?: typeof fetch
}

/**
 * Long enough to catch a subscribe burst that spans a few React commits, short
 * enough that a lone subscription doesn't feel delayed.
 */
const DEFAULT_WINDOW_MS = 15

/**
 * Bounded so one flush can't ask the server for unbounded work. The route caps
 * at 64, above this, so a legitimate flush can never trip the server guard.
 */
const DEFAULT_MAX_BATCH = 50

const RETRY_DELAY_MS = 250

/** An in-flight coalesce group. One per socket id — see {@link createBatchChannelAuthorizer}. */
interface AuthGroup {
  /** channel name → every callback waiting on it (deduped subscribers). */
  channels: Map<string, ChannelAuthorizationCallback[]>
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * `pusher:subscription_error` reads `status` off the error the callback is
 * handed, so a denial must carry 403 to stay observationally identical to what
 * the per-channel AJAX transport produced.
 */
function deniedError(channelName: string): Error {
  return Object.assign(new Error(`Channel authorization denied: ${channelName}`), { status: 403 })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Build a batching `channelAuthorization.customHandler`.
 *
 * Groups are keyed by **socket id, not globally**: a reconnect mints a new
 * socket id, and signing a callback queued before the reconnect against the new
 * id yields a VALID signature for the wrong socket — the subscription then fails
 * with nothing to log. Each queued entry carries its own `params.socketId` and
 * only ever ships with its own group.
 */
export function createBatchChannelAuthorizer(
  config: BatchAuthorizerConfig
): ChannelAuthorizationHandler {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS
  const maxBatch = config.maxBatch ?? DEFAULT_MAX_BATCH
  const groups = new Map<string, AuthGroup>()

  const post = async (
    socketId: string,
    channels: string[]
  ): Promise<Record<string, ChannelAuthorizationData | null>> => {
    const doFetch = config.fetchImpl ?? globalThis.fetch
    const response = await doFetch(config.endpoint, {
      method: 'POST',
      // Matches the AJAX transport — the session cookie must ride along.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socket_id: socketId, channels }),
    })
    if (!response.ok) {
      throw Object.assign(new Error(`Batch channel auth failed (${response.status})`), {
        status: response.status,
      })
    }
    const body = (await response.json()) as BatchAuthResponseBody | null
    return body?.results ?? {}
  }

  const send = async (socketId: string, channels: AuthGroup['channels']): Promise<void> => {
    const names = [...channels.keys()]
    let results: Record<string, ChannelAuthorizationData | null>
    try {
      results = await post(socketId, names)
    } catch {
      // One retry, then fail the whole group. No per-channel fallback to the
      // single-channel endpoint: a second code path that runs only on failure
      // is a path that is never exercised and never right. Pusher's own
      // reconnect is the real retry.
      try {
        await delay(RETRY_DELAY_MS)
        results = await post(socketId, names)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        for (const callbacks of channels.values()) {
          for (const callback of callbacks) callback(failure, null)
        }
        return
      }
    }

    for (const [name, callbacks] of channels) {
      const data = results[name] ?? null
      for (const callback of callbacks) {
        if (data) callback(null, data)
        else callback(deniedError(name), null)
      }
    }
  }

  const flush = (socketId: string): void => {
    const group = groups.get(socketId)
    if (!group) return
    groups.delete(socketId)
    if (group.timer) clearTimeout(group.timer)
    void send(socketId, group.channels)
  }

  return (params, callback) => {
    let group = groups.get(params.socketId)
    if (!group) {
      group = { channels: new Map(), timer: null }
      groups.set(params.socketId, group)
    }

    // Two components racing to subscribe the same room cost one entry and both
    // get answered.
    const waiting = group.channels.get(params.channelName)
    if (waiting) waiting.push(callback)
    else group.channels.set(params.channelName, [callback])

    if (group.channels.size >= maxBatch) {
      flush(params.socketId)
      return
    }
    if (!group.timer) {
      group.timer = setTimeout(() => flush(params.socketId), windowMs)
    }
  }
}
