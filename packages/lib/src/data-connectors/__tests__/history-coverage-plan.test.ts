// packages/lib/src/data-connectors/__tests__/history-coverage-plan.test.ts
// v15 §4 D — the gap-import plan and the coverage arithmetic.

import { describe, expect, it } from 'vitest'
import {
  type CoverageStream,
  coverageNeedsFrom,
  defaultHistoryStartDate,
  latestCoverage,
  planHistoryImport,
} from '../history-coverage-plan'

const NEEDS = '2024-11-02T00:00:00.000Z'

function stream(partial: Partial<CoverageStream> & { id: string }): CoverageStream {
  return { key: partial.id, enabled: true, backfillWindow: false, state: {}, ...partial }
}

const order = (state: CoverageStream['state']) =>
  stream({ id: 'order', decl: { period: 'createdAt', since: true, limit: true }, state })

describe('coverageNeedsFrom / defaultHistoryStartDate', () => {
  it('is the cutover minus 60 days, or null without accounting', () => {
    expect(coverageNeedsFrom(new Date('2025-01-01T00:00:00Z'))).toBe(NEEDS)
    expect(coverageNeedsFrom(null)).toBeNull()
  })

  it('defaults to 12 months back, or the books need when that is earlier', () => {
    const today = new Date('2026-09-28T12:00:00Z')
    expect(defaultHistoryStartDate(null, today)).toBe('2025-09-28')
    expect(defaultHistoryStartDate(new Date('2026-06-01T00:00:00Z'), today)).toBe('2025-09-28')
    expect(defaultHistoryStartDate(new Date('2025-01-01T00:00:00Z'), today)).toBe('2024-11-02')
  })
})

describe('latestCoverage', () => {
  it('takes the stream that reaches least far back; null only when all reach everything', () => {
    expect(latestCoverage(['2025-01-01T00:00:00Z', null, '2025-03-01T00:00:00Z'])).toBe(
      '2025-03-01T00:00:00Z'
    )
    expect(latestCoverage([null, null])).toBeNull()
  })
})

describe('planHistoryImport', () => {
  const base = { needsFrom: NEEDS, cutoverStart: new Date('2025-01-01T00:00:00Z') }

  it('re-imports finished since streams up to the latest coverage + 1s, in one run', () => {
    const plan = planHistoryImport({
      ...base,
      historyStartDate: '2025-06-01',
      streams: [
        order({ phase: 'steady', coverageFrom: '2025-03-03T10:00:00.000Z' }),
        stream({
          id: 'customer',
          decl: { period: 'updatedAt', since: true },
          state: { phase: 'steady', coverageFrom: '2025-02-01T00:00:00.000Z' },
        }),
      ],
    })
    expect(plan.reimport).toEqual({
      streamIds: ['order', 'customer'],
      period: { from: NEEDS, to: '2025-03-03T10:00:01.000Z' },
    })
    expect(plan.historyStartDate).toBe('2024-11-02')
    expect(plan.syncNow).toBe(false)
  })

  it('picks a sync for rescan streams, a resync stamp for windows, and waits on unfinished backfills', () => {
    const plan = planHistoryImport({
      ...base,
      historyStartDate: '2025-06-01',
      streams: [
        stream({
          id: 'payout',
          decl: { period: 'issuedAt' },
          state: { coverageFrom: '2025-06-01' },
        }),
        stream({ id: 'rest', backfillWindow: true }),
        order({ phase: 'backfill' }),
      ],
    })
    expect(plan.syncNow).toBe(true)
    expect(plan.resyncStreamIds).toEqual(['rest'])
    expect(plan.waiting).toEqual(['order'])
    expect(plan.reimport).toBeNull()
  })

  it('skips snapshot, since-only, disabled and already-covered streams', () => {
    const plan = planHistoryImport({
      ...base,
      historyStartDate: '2025-06-01',
      streams: [
        stream({ id: 'product', state: { phase: 'steady' } }),
        stream({ id: 'issue', decl: { since: true }, state: { phase: 'steady' } }),
        stream({ ...order({ phase: 'steady' }), id: 'off', enabled: false }),
        order({ phase: 'steady', coverageFrom: '2024-10-01T00:00:00.000Z' }),
      ],
    })
    expect(plan.reimport).toBeNull()
    expect(plan.syncNow).toBe(false)
    expect(plan.resyncStreamIds).toEqual([])
  })

  it('only ever moves the start date earlier', () => {
    const streams = [order({ phase: 'steady', coverageFrom: '2025-03-01T00:00:00.000Z' })]
    expect(
      planHistoryImport({ ...base, historyStartDate: '2024-01-01', streams }).historyStartDate
    ).toBeUndefined()
    // Absent means everything already.
    expect(
      planHistoryImport({ ...base, historyStartDate: undefined, streams }).historyStartDate
    ).toBeUndefined()
    expect(
      planHistoryImport({ ...base, historyStartDate: '2025-02-01', streams }).historyStartDate
    ).toBe('2024-11-02')
  })

  it('takes a stream with no recorded coverage to reach its floor', () => {
    // No coverage key: the floor is min(historyStartDate, cutover) = the cutover, after NEEDS.
    const plan = planHistoryImport({
      ...base,
      historyStartDate: '2025-06-01',
      streams: [order({ phase: 'steady' })],
    })
    expect(plan.reimport?.period.to).toBe('2025-01-01T00:00:01.000Z')
  })
})
