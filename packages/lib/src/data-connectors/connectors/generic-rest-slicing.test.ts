// packages/lib/src/data-connectors/connectors/generic-rest-slicing.test.ts
// Slicing contract for generic-rest (Step 3b): a checkpoint sentinel after each
// page carrying the resume cursor, resume from `state.backfillCursor`, and a typed
// throttle error when the transport is told not to sleep (H1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { genericRestConnector } from './generic-rest'
import {
  type ConnectorFetchArgs,
  ConnectorRateLimitError,
  type ConnectorYield,
  isConnectorCheckpoint,
} from './types'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function args(over: Partial<ConnectorFetchArgs> = {}): ConnectorFetchArgs {
  return {
    streamKey: 's1',
    mode: 'snapshot',
    state: {},
    credential: null,
    config: {
      endpoint: {
        baseUrl: 'https://api.example.com',
        auth: 'none',
        pagination: { kind: 'cursor', cursorPath: 'next', cursorParam: 'cursor' },
      },
    },
    requestConfig: { path: 'orders' },
    ...over,
  }
}

async function collect(a: ConnectorFetchArgs): Promise<ConnectorYield[]> {
  const { records } = await genericRestConnector.fetch(a)
  const out: ConnectorYield[] = []
  for await (const y of records) out.push(y)
  return out
}

describe('generic-rest slicing', () => {
  it('interleaves a checkpoint after each page, terminal checkpoint has no cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: [1], next: 'c1' }))
      .mockResolvedValueOnce(json({ data: [2], next: 'c2' }))
      .mockResolvedValueOnce(json({ data: [3] })) // no next → exhausted

    const yields = await collect(args())

    expect(yields).toHaveLength(6)
    expect(isConnectorCheckpoint(yields[0]!)).toBe(false)
    expect(yields[1]).toEqual({ __checkpoint: true, cursor: { kind: 'token', value: 'c1' } })
    expect(yields[3]).toEqual({ __checkpoint: true, cursor: { kind: 'token', value: 'c2' } })
    // Terminal checkpoint — no cursor signals the source is exhausted.
    expect(yields[5]).toEqual({ __checkpoint: true })
  })

  it('resumes from state.backfillCursor (cursor token)', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [9] })) // single page, no next

    await collect(args({ state: { backfillCursor: { kind: 'token', value: 'c1' } } }))

    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('cursor=c1')
  })

  it('resumes page pagination from the saved page index', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [{}] })) // non-empty → keep going
      .mockResolvedValueOnce(json({ items: [] })) // empty page → exhausted

    const yields = await collect(
      args({
        config: {
          endpoint: {
            baseUrl: 'https://api.example.com',
            auth: 'none',
            pagination: { kind: 'page', pageParam: 'page' },
          },
        },
        state: { backfillCursor: { kind: 'pageNumber', value: '3' } },
      })
    )

    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('page=4') // pageIndex 3 → page param 3+1
    expect(yields[1]).toEqual({ __checkpoint: true, cursor: { kind: 'pageNumber', value: '4' } })
  })

  it('H1: throws ConnectorRateLimitError on a 429 the transport did not sleep through', async () => {
    // Fresh Response per call (a Response body can only be read once).
    fetchMock.mockImplementation(async () =>
      json({ error: 'slow down' }, 429, { 'retry-after': '2' })
    )

    const error = await collect(args({ rateLimitOverride: { maxRetries: 0 } })).catch((e) => e)
    expect(error).toBeInstanceOf(ConnectorRateLimitError)
    // ConnectorRateLimitError carries the parsed Retry-After in ms.
    expect(error.retryAfterMs).toBe(2_000)
  })
})

describe('generic-rest steady mode (G2)', () => {
  const incremental = { sinceParam: 'updated_at_min', watermarkField: 'updated_at' }

  it('injects the since-param from the watermark only on an incremental run', async () => {
    fetchMock.mockResolvedValueOnce(json([{ updated_at: '2026-05-01' }]))
    await collect(
      args({
        mode: 'incremental',
        state: { watermark: '2026-04-01' },
        requestConfig: { path: 'orders', pagination: { kind: 'none' }, incremental },
      })
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('updated_at_min=2026-04-01')
  })

  it('does NOT inject the since-param during a backfill (snapshot) run', async () => {
    fetchMock.mockResolvedValueOnce(json([{ updated_at: '2026-05-01' }]))
    await collect(
      args({
        mode: 'snapshot',
        state: { watermark: '2026-04-01' },
        requestConfig: { path: 'orders', pagination: { kind: 'none' }, incremental },
      })
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).not.toContain('updated_at_min')
  })

  it('emits the page max watermark on the checkpoint (over ALL records)', async () => {
    fetchMock.mockResolvedValueOnce(
      json([
        { updated_at: '2026-05-01' },
        { updated_at: '2026-06-15' },
        { updated_at: '2026-05-20' },
      ])
    )
    const yields = await collect(
      args({
        mode: 'incremental',
        state: { watermark: '2026-04-01' },
        requestConfig: { path: 'orders', pagination: { kind: 'none' }, incremental },
      })
    )
    // Single page (no pagination) → terminal checkpoint carries the max updated_at.
    expect(yields.at(-1)).toEqual({ __checkpoint: true, watermark: '2026-06-15' })
  })
})
