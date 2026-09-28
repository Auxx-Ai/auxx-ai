// packages/lib/src/data-connectors/__tests__/history-floor.test.ts
// The history floor never passes an accounting-active org's cutover (v13 N2, v14 §3).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const accounting = { active: false, cutoverStart: null as Date | null }
const readActiveCutoverStart = vi.fn(async () =>
  accounting.active ? accounting.cutoverStart : null
)
vi.mock('../../accounting/ledger/setup/cutover-start', () => ({
  readActiveCutoverStart: () => readActiveCutoverStart(),
}))

import { freshBackfillState, historyFloor, wipedStreamState } from '../slice-orchestrator'

beforeEach(() => {
  accounting.active = false
  accounting.cutoverStart = null
  readActiveCutoverStart.mockClear()
})

describe('historyFloor', () => {
  it('has no floor without a history date, and never reads the cutover', async () => {
    expect(await historyFloor('org1', undefined)).toBeUndefined()
    expect(await historyFloor('org1', 'not-a-date')).toBeUndefined()
    expect(readActiveCutoverStart).not.toHaveBeenCalled()
  })

  it('is the date at UTC midnight for an org without active accounting', async () => {
    accounting.cutoverStart = new Date('2025-10-01T07:00:00.000Z')
    expect(await historyFloor('org1', '2026-06-01')).toBe('2026-06-01T00:00:00.000Z')
  })

  it('moves earlier to a cutover before the date', async () => {
    accounting.active = true
    accounting.cutoverStart = new Date('2025-10-01T07:00:00.000Z')
    expect(await historyFloor('org1', '2026-06-01')).toBe('2025-10-01T07:00:00.000Z')
  })

  it('keeps the date when the cutover is later than it', async () => {
    accounting.active = true
    accounting.cutoverStart = new Date('2026-09-01T07:00:00.000Z')
    expect(await historyFloor('org1', '2026-06-01')).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('freshBackfillState — the history limit caps only a first backfill (v15 §3.5)', () => {
  const at = '2026-09-01T00:00:00.000Z'
  it('marks a stream that finished a backfill, and keeps its coverage until the new crawl ends', () => {
    const next = freshBackfillState({ phase: 'steady', coverageFrom: null, watermark: 'w' }, at)
    expect(next).toMatchObject({ phase: 'backfill', backfilledBefore: true, coverageFrom: null })
    expect(next.watermark).toBeUndefined()
    // A second reset mid-crawl keeps the mark.
    expect(freshBackfillState(next, at).backfilledBefore).toBe(true)
  })
  it('leaves a stream that never finished unmarked', () => {
    expect(freshBackfillState({}, at).backfilledBefore).toBeUndefined()
    expect(freshBackfillState({ phase: 'backfill' }, at).backfilledBefore).toBeUndefined()
  })
})

describe('wipedStreamState — a wipe makes the next crawl a first import again', () => {
  it('drops backfilledBefore and coverageFrom but keeps the rest of the fresh state', () => {
    const at = '2026-09-28T00:00:00.000Z'
    const next = wipedStreamState(
      {
        phase: 'steady',
        coverageFrom: '2025-11-02T00:00:00.000Z',
        backfilledBefore: true,
        watermark: 'w',
      },
      at
    )
    expect(next.backfilledBefore).toBeUndefined()
    expect(next.coverageFrom).toBeUndefined()
    expect(next).toMatchObject({ phase: 'backfill', backfillStartedAt: at, recordsSeen: 0 })
    expect(next.watermark).toBeUndefined()
  })
})
