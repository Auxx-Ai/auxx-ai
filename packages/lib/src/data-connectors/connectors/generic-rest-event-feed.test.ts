// packages/lib/src/data-connectors/connectors/generic-rest-event-feed.test.ts
// Step 8D — the Stripe-style event-feed incremental kind. A steady run polls the
// event log, expands each event into a per-object upsert (or a delete tombstone for
// `*.deleted`), filters the firehose to this stream's object type, injects the
// `created[gte]` floor, and advances the watermark over ALL events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { genericRestConnector } from './generic-rest'
import { type ConnectorFetchArgs, type ConnectorYield, isConnectorCheckpoint } from './types'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function eventFeedArgs(): ConnectorFetchArgs {
  return {
    streamKey: 'customer',
    mode: 'incremental',
    state: { watermark: '100' },
    credential: null,
    config: { endpoint: { baseUrl: 'https://api.stripe.com', auth: 'none' } },
    requestConfig: {
      path: '/v1/customers',
      pagination: {
        kind: 'cursor',
        cursorFrom: 'lastRecord',
        cursorRecordField: 'id',
        recordsPath: 'data',
        hasMorePath: 'has_more',
        cursorParam: 'starting_after',
      },
      incremental: {
        kind: 'event-feed',
        sinceParam: 'created[gte]',
        watermarkField: 'created',
        eventsPath: '/v1/events',
        deleteEventTypes: ['customer.deleted'],
        objectPath: 'data.object',
      },
    },
  }
}

async function collect(a: ConnectorFetchArgs): Promise<ConnectorYield[]> {
  const { records } = await genericRestConnector.fetch(a)
  const out: ConnectorYield[] = []
  for await (const y of records) out.push(y)
  return out
}

describe('generic-rest event-feed (Step 8D)', () => {
  it('expands events into per-object upserts + delete tombstones, filtered to the stream', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'evt1',
            type: 'customer.updated',
            created: 101,
            data: { object: { id: 'cus_1', object: 'customer' } },
          },
          {
            id: 'evt2',
            type: 'customer.deleted',
            created: 102,
            data: { object: { id: 'cus_2', object: 'customer' } },
          },
          {
            id: 'evt3',
            type: 'charge.updated',
            created: 103,
            data: { object: { id: 'ch_1', object: 'charge' } },
          },
        ],
      })
    )

    const yields = await collect(eventFeedArgs())
    const records = yields.filter((y) => !isConnectorCheckpoint(y))

    // The charge event is filtered out (wrong object type); the two customer events remain.
    expect(records).toEqual([
      { streamKey: 'customer', fields: { id: 'cus_1', object: 'customer' }, deleted: false },
      { streamKey: 'customer', fields: { id: 'cus_2', object: 'customer' }, deleted: true },
    ])

    // Watermark advances over ALL events (incl. the filtered charge) → max created.
    const terminal = yields.at(-1)
    expect(isConnectorCheckpoint(terminal!)).toBe(true)
    expect((terminal as { watermark?: string }).watermark).toBe('103')
  })

  it('polls the events endpoint and injects the created[gte] floor', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [], has_more: false }))
    await collect(eventFeedArgs())

    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('/v1/events')
    expect(url).toContain('created%5Bgte%5D=100')
  })
})
