// packages/lib/src/postings/provider-sync/__tests__/provider-sync-cutover-floor.test.ts
//
// 🛑 The SECOND of the two ways this feature can double a ledger (brief 20
// §5.4, §13).
//
// Brief 19's opening entry IS the provider's own pre-cutover position, restated
// as one entry of ours. Reading back the period it summarises imports the very
// balances it was derived from and doubles the entire opening position - and
// like the exclusion, both copies balance, every statement ties, and nothing
// downstream can detect it.
//
// The floor is asserted BEFORE the call and refuses rather than clamps, so
// there is no path that reaches a date below it and no "the filter had a bug"
// failure mode.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { cutoverDateFor } from '../../build-opening-balance-entry'
import { planSyncChunks, providerSyncFloor } from '../range'

describe('the cutover floor', () => {
  it('starts the day AFTER the opening entry is dated', () => {
    // The opening entry is dated the last day of `cutoffPeriod`
    // (`cutoverDateFor`), so the floor is the next day - and the two functions
    // are checked against each other rather than against two hard-coded dates.
    expect(cutoverDateFor('2025-12')).toBe('2025-12-31')
    expect(providerSyncFloor('2025-12')._unsafeUnwrap()).toBe('2026-01-01')

    expect(cutoverDateFor('2026-02')).toBe('2026-02-28')
    expect(providerSyncFloor('2026-02')._unsafeUnwrap()).toBe('2026-03-01')
  })

  it('🛑 never plans a chunk reaching into the period the opening entry summarises', () => {
    const chunks = planSyncChunks({ cutoffPeriod: '2025-12', to: '2026-03-15' })._unsafeUnwrap()

    expect(chunks[0]?.from).toBe('2026-01-01')
    for (const chunk of chunks) {
      expect(chunk.from >= '2026-01-01').toBe(true)
      // The opening entry's own date, and everything before it.
      expect(chunk.from > cutoverDateFor('2025-12')).toBe(true)
    }
  })

  it('🛑 REFUSES a range below the floor rather than clamping it', () => {
    // Clamping is the tempting version and it is wrong: a caller who asked for
    // 2025 would be told "nothing found in 2025", which reads as "the
    // accountant did no work" rather than "we will not look there".
    const refused = planSyncChunks({
      cutoffPeriod: '2025-12',
      from: '2025-06-01',
      to: '2026-03-15',
    })

    expect(refused.isErr()).toBe(true)
    const error = refused._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('2026-01-01')
    expect(error.message).toContain('double')
  })

  it('refuses the day before the floor, not just a wide miss', () => {
    const refused = planSyncChunks({
      cutoffPeriod: '2025-12',
      from: '2025-12-31',
      to: '2026-01-31',
    })
    expect(refused.isErr()).toBe(true)
  })

  it('refuses when the cutoff is not a month, rather than guessing one', () => {
    expect(planSyncChunks({ cutoffPeriod: '', to: '2026-03-15' }).isErr()).toBe(true)
    expect(planSyncChunks({ cutoffPeriod: '2025-12-31', to: '2026-03-15' }).isErr()).toBe(true)
    expect(planSyncChunks({ cutoffPeriod: '2025-13', to: '2026-03-15' }).isErr()).toBe(true)
  })
})

describe('chunking', () => {
  it('walks one month per call, clipped at both ends', () => {
    const chunks = planSyncChunks({
      cutoffPeriod: '2025-12',
      from: '2026-01-10',
      to: '2026-03-15',
    })._unsafeUnwrap()

    expect(chunks).toEqual([
      { from: '2026-01-10', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-15' },
    ])
  })

  it('covers the range with no gaps and no overlaps', () => {
    const chunks = planSyncChunks({ cutoffPeriod: '2023-12', to: '2026-09-10' })._unsafeUnwrap()

    expect(chunks[0]?.from).toBe('2024-01-01')
    expect(chunks.at(-1)?.to).toBe('2026-09-10')
    // 2024 is a leap year, and February is where a naive +30 days walk shows it.
    expect(chunks[1]).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1]
      const current = chunks[i]
      expect(previous && current && previous.to < current.from).toBe(true)
    }
  })

  it('crosses a year boundary', () => {
    const chunks = planSyncChunks({
      cutoffPeriod: '2025-11',
      from: '2025-12-20',
      to: '2026-01-05',
    })._unsafeUnwrap()

    expect(chunks).toEqual([
      { from: '2025-12-20', to: '2025-12-31' },
      { from: '2026-01-01', to: '2026-01-05' },
    ])
  })

  it('yields one chunk for a single day', () => {
    const chunks = planSyncChunks({
      cutoffPeriod: '2025-12',
      from: '2026-02-10',
      to: '2026-02-10',
    })._unsafeUnwrap()
    expect(chunks).toEqual([{ from: '2026-02-10', to: '2026-02-10' }])
  })

  it('refuses an end date before the start', () => {
    expect(
      planSyncChunks({ cutoffPeriod: '2025-12', from: '2026-03-01', to: '2026-02-01' }).isErr()
    ).toBe(true)
  })
})
