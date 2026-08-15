// packages/lib/src/connections/transports/__tests__/http-pacing.test.ts
// The transport's PROACTIVE half (the reactive half lives in http.test.ts). Runs over
// the pacer's in-process fallback — same cursor arithmetic as the Lua path, and it
// keeps the assertions about the transport rather than about Redis.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisClient: async () => null,
}))

import { resetPacerState } from '../../../utils/rate-limiter/pacer'
import type { RuntimeConnectionData } from '../../resolve-connection-for-runtime'
import { httpTransport } from '../http'

const conn = (id: string): RuntimeConnectionData =>
  ({ id, type: 'api-key', value: 'k', authApply: null }) as unknown as RuntimeConnectionData

function stubFetch(specs: Array<{ status: number; headers?: Record<string, string> }>) {
  const state = { count: 0 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const spec = specs[Math.min(state.count, specs.length - 1)]!
      state.count++
      return new Response('{}', { status: spec.status, headers: spec.headers })
    })
  )
  return state
}

beforeEach(() => {
  resetPacerState()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('httpTransport proactive pacing', () => {
  it('does not pace when the policy declares no rate', async () => {
    stubFetch([{ status: 200 }])

    const res = await httpTransport.request(conn('c-unpaced'), {
      method: 'GET',
      url: 'https://api.example.com/v1',
    })

    expect(res.rateLimitWaitMs).toBe(0)
  })

  it('does not pace without a connection — there is nothing to share a budget on', async () => {
    stubFetch([{ status: 200 }])

    const res = await httpTransport.request(null, {
      method: 'GET',
      url: 'https://api.example.com/v1',
      rateLimit: { rps: 20 },
    })

    // Falls through to the legacy local floor, which is unset here.
    expect(res.rateLimitWaitMs).toBe(0)
  })

  it('reserves a slot per request on the connection cursor, so a second call waits', async () => {
    stubFetch([{ status: 200 }])
    const req = {
      method: 'GET' as const,
      url: 'https://api.example.com/v1',
      rateLimit: { rps: 20 }, // 50ms interval
    }

    const first = await httpTransport.request(conn('c-paced'), req)
    const second = await httpTransport.request(conn('c-paced'), req)

    expect(first.rateLimitWaitMs).toBe(0)
    expect(second.rateLimitWaitMs).toBeGreaterThan(0)
    expect(second.rateLimitWaitMs).toBeLessThanOrEqual(50)
  })

  it('keeps two different connections on separate budgets', async () => {
    stubFetch([{ status: 200 }])
    const req = {
      method: 'GET' as const,
      url: 'https://api.example.com/v1',
      rateLimit: { rps: 20 },
    }

    await httpTransport.request(conn('c-a'), req)
    const otherConnection = await httpTransport.request(conn('c-b'), req)

    expect(otherConnection.rateLimitWaitMs).toBe(0)
  })

  it('reads minDelayMs as a rate when a connection is in scope', async () => {
    stubFetch([{ status: 200 }])
    const req = {
      method: 'GET' as const,
      url: 'https://api.example.com/v1',
      rateLimit: { minDelayMs: 40 },
    }

    const first = await httpTransport.request(conn('c-mindelay'), req)
    const second = await httpTransport.request(conn('c-mindelay'), req)

    // Paced BEFORE the request, not slept after it — so the first call is free.
    expect(first.rateLimitWaitMs).toBe(0)
    expect(second.rateLimitWaitMs).toBeGreaterThan(0)
    expect(second.rateLimitWaitMs).toBeLessThanOrEqual(40)
  })

  it('still applies minDelayMs as a local floor when there is no connection', async () => {
    stubFetch([{ status: 200 }])

    const res = await httpTransport.request(null, {
      method: 'GET',
      url: 'https://api.example.com/v1',
      rateLimit: { minDelayMs: 20 },
    })

    expect(res.rateLimitWaitMs).toBe(20)
  })

  it('folds an observed Retry-After onto the shared cursor instead of sleeping twice', async () => {
    const counter = stubFetch([
      { status: 429, headers: { 'retry-after': '0.05' } },
      { status: 200 },
    ])

    const res = await httpTransport.request(conn('c-429'), {
      method: 'GET',
      url: 'https://api.example.com/v1',
      rateLimit: { rps: 20, maxRetries: 3 },
    })

    expect(counter.count).toBe(2)
    expect(res.status).toBe(200)
    // The 50ms came back through the next reservation, and is still accounted for.
    expect(res.rateLimitWaitMs).toBeGreaterThan(30)
    expect(res.rateLimitWaitMs).toBeLessThanOrEqual(60)
  })
})
