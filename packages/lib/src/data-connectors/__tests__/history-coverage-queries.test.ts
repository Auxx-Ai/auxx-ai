// packages/lib/src/data-connectors/__tests__/history-coverage-queries.test.ts
// v15 §4 D — readConnectorCoverage over every connector.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cutover = vi.fn<() => Promise<Date | null>>()
vi.mock('../../accounting/ledger/setup/cutover-start', () => ({
  readActiveCutoverStart: () => cutover(),
}))

const shopifyStreams = [
  { key: 'order', query: { period: 'createdAt', since: true, limit: true } },
  { key: 'customer', query: { since: true } },
  { key: 'product' },
  { key: 'payout', query: { period: 'issuedAt' } },
]
vi.mock('../connectors/app-connector-adapter', () => ({
  loadAppCatalogConnector: async () => ({ streams: shopifyStreams }),
}))

const { readConnectorCoverage } = await import('../history-coverage-queries')

function connector(id: string, partial: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    type: 'app:shopify',
    status: 'live',
    definitionKind: 'app',
    appInstallationId: 'inst',
    config: {},
    ...partial,
  }
}

function fakeDb(connectors: unknown[], streams: unknown[]): Database {
  return {
    query: {
      DataConnector: { findMany: async () => connectors },
      DataConnectorStream: { findMany: async () => streams },
    },
  } as unknown as Database
}

const s = (dataConnectorId: string, streamKey: string, state: Record<string, unknown>) => ({
  id: `${dataConnectorId}-${streamKey}`,
  dataConnectorId,
  streamKey,
  enabled: true,
  requestConfig: null,
  state,
})

describe('readConnectorCoverage', () => {
  beforeEach(() => cutover.mockReset())

  it('aggregates the least far back period stream and ignores snapshot and since-only streams', async () => {
    cutover.mockResolvedValue(new Date('2025-01-01T00:00:00Z'))
    const db = fakeDb(
      [connector('shop')],
      [
        s('shop', 'order', { phase: 'steady', coverageFrom: '2024-10-01T00:00:00.000Z' }),
        s('shop', 'payout', { phase: 'steady', coverageFrom: '2024-12-15T00:00:00.000Z' }),
        // Neither a snapshot nor a since-only stream counts, however late its coverage.
        s('shop', 'product', { phase: 'steady', coverageFrom: '2026-01-01T00:00:00.000Z' }),
        s('shop', 'customer', { phase: 'steady', coverageFrom: '2026-01-01T00:00:00.000Z' }),
      ]
    )
    const report = (await readConnectorCoverage(db, 'org'))._unsafeUnwrap()
    expect(report.needsFrom).toBe('2024-11-02T00:00:00.000Z')
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      connectorId: 'shop',
      coverageFrom: '2024-12-15T00:00:00.000Z',
      ok: false,
    })
  })

  it('is ok when every period stream reaches the need, and null reads as everything', async () => {
    cutover.mockResolvedValue(new Date('2025-01-01T00:00:00Z'))
    const db = fakeDb(
      [connector('shop')],
      [
        s('shop', 'order', { phase: 'steady', coverageFrom: null }),
        s('shop', 'payout', { phase: 'steady', coverageFrom: '2024-11-01T00:00:00.000Z' }),
      ]
    )
    const [row] = (await readConnectorCoverage(db, 'org'))._unsafeUnwrap().rows
    expect(row).toMatchObject({ coverageFrom: '2024-11-01T00:00:00.000Z', ok: true })
  })

  it('without accounting lists coverage with no verdict', async () => {
    cutover.mockResolvedValue(null)
    const db = fakeDb(
      [connector('shop', { config: { historyStartDate: '2025-09-28' } })],
      [s('shop', 'order', { phase: 'backfill' })]
    )
    const report = (await readConnectorCoverage(db, 'org'))._unsafeUnwrap()
    expect(report.needsFrom).toBeNull()
    // Nothing recorded yet: the stream is taken to reach its floor.
    expect(report.rows[0]).toMatchObject({
      coverageFrom: '2025-09-28T00:00:00.000Z',
      ok: null,
      historyStartDate: '2025-09-28',
    })
  })

  it('leaves out connectors with no date-bounded stream', async () => {
    cutover.mockResolvedValue(null)
    const db = fakeDb(
      [connector('shop'), connector('rest', { type: 'generic-rest', definitionKind: 'builtin' })],
      [s('shop', 'product', { phase: 'steady' }), s('rest', 'items', { phase: 'steady' })]
    )
    expect((await readConnectorCoverage(db, 'org'))._unsafeUnwrap().rows).toEqual([])
  })
})
