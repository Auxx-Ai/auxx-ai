// packages/lib/src/realtime/client/adapters/batch-channel-authorizer.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelAuthorizationData } from './batch-channel-authorizer'
import { createBatchChannelAuthorizer } from './batch-channel-authorizer'

/**
 * The batcher is pure — no pusher-js, no socket, no DOM — so these run against
 * the real implementation with only `fetch` injected.
 *
 * What matters here is not that batching happens but that it is INVISIBLE:
 * every callback must receive exactly what the per-channel AJAX transport would
 * have handed it, including a 403-carrying error on denial (which is what
 * pusher-js reads to emit `pusher:subscription_error`).
 */

const ENDPOINT = '/api/pusher/auth/batch'
const SOCKET = '6189518247.123456'
const CHANNEL_A = 'private-org-abgwpa1l81reht2zmwrcihfu-records-xrbtfl7syi3sm4mqf5wiayuz'
const CHANNEL_B = 'private-org-abgwpa1l81reht2zmwrcihfu-records-elppl4chr8dhnjfibwryu5to'
const CHANNEL_C = 'presence-org-abgwpa1l81reht2zmwrcihfu'

/** A `fetch` stub that answers from a channel → auth-data map. */
function okFetch(results: Record<string, ChannelAuthorizationData | null>) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results }),
  })) as unknown as typeof fetch
}

type MockFn = ReturnType<typeof vi.fn>

/** Nth recorded call's arguments, asserted present so the tests stay flat. */
function callArgs(fn: unknown, index = 0): unknown[] {
  const calls = (fn as MockFn).mock.calls
  const args = calls[index]
  if (!args) throw new Error(`expected at least ${index + 1} call(s), saw ${calls.length}`)
  return args
}

function bodyOf(fetchMock: typeof fetch, call = 0): { socket_id: string; channels: string[] } {
  const [, init] = callArgs(fetchMock, call) as [string, { body: string }]
  return JSON.parse(init.body)
}

/** The `(error, authData)` pair a channel's callback was invoked with. */
function verdict(callback: unknown): [Error | null, ChannelAuthorizationData | null] {
  return callArgs(callback) as [Error | null, ChannelAuthorizationData | null]
}

const auth = (sig: string): ChannelAuthorizationData => ({ auth: sig })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createBatchChannelAuthorizer', () => {
  it('coalesces one tick of subscriptions into a single request', async () => {
    const fetchImpl = okFetch({
      [CHANNEL_A]: auth('a'),
      [CHANNEL_B]: auth('b'),
      [CHANNEL_C]: auth('c'),
    })
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const cbA = vi.fn()
    const cbB = vi.fn()
    const cbC = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, cbA)
    authorize({ socketId: SOCKET, channelName: CHANNEL_B }, cbB)
    authorize({ socketId: SOCKET, channelName: CHANNEL_C }, cbC)
    expect(fetchImpl).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl)).toEqual({
      socket_id: SOCKET,
      channels: [CHANNEL_A, CHANNEL_B, CHANNEL_C],
    })
    expect(cbA).toHaveBeenCalledWith(null, auth('a'))
    expect(cbB).toHaveBeenCalledWith(null, auth('b'))
    expect(cbC).toHaveBeenCalledWith(null, auth('c'))
  })

  it('opens a fresh batch after the window closes', async () => {
    const fetchImpl = okFetch({ [CHANNEL_A]: auth('a'), [CHANNEL_B]: auth('b') })
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, vi.fn())
    await vi.advanceTimersByTimeAsync(20)
    authorize({ socketId: SOCKET, channelName: CHANNEL_B }, vi.fn())
    await vi.advanceTimersByTimeAsync(20)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchImpl, 0).channels).toEqual([CHANNEL_A])
    expect(bodyOf(fetchImpl, 1).channels).toEqual([CHANNEL_B])
  })

  it('sends one entry for a duplicated channel and answers every waiter', async () => {
    const fetchImpl = okFetch({ [CHANNEL_A]: auth('a') })
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const first = vi.fn()
    const second = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, first)
    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, second)
    await vi.advanceTimersByTimeAsync(20)

    expect(bodyOf(fetchImpl).channels).toEqual([CHANNEL_A])
    expect(first).toHaveBeenCalledWith(null, auth('a'))
    expect(second).toHaveBeenCalledWith(null, auth('a'))
  })

  /**
   * The reconnect guard. A callback queued before a reconnect must never be
   * signed against the socket id minted after it — that signature is VALID, so
   * the subscription fails with nothing to log.
   */
  it('never mixes two socket ids into one request', async () => {
    const RECONNECTED = '9911223344.998877'
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const { socket_id, channels } = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: Object.fromEntries(channels.map((c: string) => [c, auth(`${socket_id}:${c}`)])),
        }),
      }
    }) as unknown as typeof fetch
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const stale = vi.fn()
    const fresh = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, stale)
    authorize({ socketId: RECONNECTED, channelName: CHANNEL_A }, fresh)
    await vi.advanceTimersByTimeAsync(20)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchImpl, 0).socket_id).toBe(SOCKET)
    expect(bodyOf(fetchImpl, 1).socket_id).toBe(RECONNECTED)
    expect(stale).toHaveBeenCalledWith(null, auth(`${SOCKET}:${CHANNEL_A}`))
    expect(fresh).toHaveBeenCalledWith(null, auth(`${RECONNECTED}:${CHANNEL_A}`))
  })

  it('fails a denied channel with a 403 error and still authorizes its siblings', async () => {
    const fetchImpl = okFetch({ [CHANNEL_A]: auth('a'), [CHANNEL_B]: null })
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const allowed = vi.fn()
    const denied = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, allowed)
    authorize({ socketId: SOCKET, channelName: CHANNEL_B }, denied)
    await vi.advanceTimersByTimeAsync(20)

    expect(allowed).toHaveBeenCalledWith(null, auth('a'))
    const [error, data] = verdict(denied)
    expect(data).toBeNull()
    expect(error).toBeInstanceOf(Error)
    expect((error as Error & { status?: number }).status).toBe(403)
  })

  /** A channel the server omits entirely is a denial, not a hang. */
  it('treats an absent result as a denial', async () => {
    const fetchImpl = okFetch({})
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const callback = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, callback)
    await vi.advanceTimersByTimeAsync(20)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(verdict(callback)[1]).toBeNull()
  })

  it('retries a failed request once, then fails every callback in the group', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const cbA = vi.fn()
    const cbB = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, cbA)
    authorize({ socketId: SOCKET, channelName: CHANNEL_B }, cbB)
    await vi.advanceTimersByTimeAsync(20)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(cbA).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(verdict(cbA)[0]).toBeInstanceOf(Error)
    expect(verdict(cbA)[1]).toBeNull()
    expect(verdict(cbB)[0]).toBeInstanceOf(Error)
  })

  it('recovers when the retry succeeds', async () => {
    let attempt = 0
    const fetchImpl = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('offline')
      return { ok: true, status: 200, json: async () => ({ results: { [CHANNEL_A]: auth('a') } }) }
    }) as unknown as typeof fetch
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const callback = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, callback)
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(300)

    expect(callback).toHaveBeenCalledWith(null, auth('a'))
  })

  it('treats a non-2xx response as a request failure', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'nope' }),
    })) as unknown as typeof fetch
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })
    const callback = vi.fn()

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, callback)
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(300)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(verdict(callback)[0]).toBeInstanceOf(Error)
    expect(verdict(callback)[1]).toBeNull()
  })

  it('flushes immediately once maxBatch is reached', async () => {
    const fetchImpl = okFetch({ [CHANNEL_A]: auth('a'), [CHANNEL_B]: auth('b') })
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl, maxBatch: 2 })

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, vi.fn())
    authorize({ socketId: SOCKET, channelName: CHANNEL_B }, vi.fn())

    // No timer advance — the cap, not the window, released this one.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl).channels).toEqual([CHANNEL_A, CHANNEL_B])

    await vi.advanceTimersByTimeAsync(20)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('posts JSON to the configured endpoint with same-origin credentials', async () => {
    const fetchImpl = okFetch({ [CHANNEL_A]: auth('a') })
    const authorize = createBatchChannelAuthorizer({ endpoint: ENDPOINT, fetchImpl })

    authorize({ socketId: SOCKET, channelName: CHANNEL_A }, vi.fn())
    await vi.advanceTimersByTimeAsync(20)

    const [url, init] = callArgs(fetchImpl) as [string, RequestInit & { headers: HeadersInit }]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})
