// packages/lib/src/postings/__tests__/sync-queue-state.test.ts
//
// `syncQueueState` is the one place the sync queue's TWO status axes collapse
// into one word (plans/accounting/tasks/53-two-modes-one-ledger.md §7.2.5), so
// every mistake it can make shows up as a queue that lies about what it is
// holding. The three that matter:
//
//   * calling a HELD posting an error, which turns a healthy hold into forty
//     red rows on the day somebody switches the hold on;
//   * calling a RELEASED posting held, which offers a Sync button for work that
//     is already on its way and invites a second release;
//   * calling a LEGACY posting held, which offers a Sync button that cannot do
//     anything at all - a legacy row has no `AccountingDelivery` to release.

import { describe, expect, it } from 'vitest'
import { type SyncQueueRow, syncQueueState } from '../types'

function row(overrides: Partial<SyncQueueRow> = {}): SyncQueueRow {
  return {
    periodKey: '2026-08',
    postingType: 'month_end_inventory',
    glPostingId: 'gl_1',
    exportStatus: 'pending',
    docNumber: 'GL-ME-2026-08',
    attempts: 0,
    failureReason: null,
    txnDate: '2026-08-31',
    totalMinor: 1250,
    currency: 'USD',
    deliveryIntent: 'manual',
    releasedAt: null,
    deliveryState: null,
    ...overrides,
  }
}

describe('syncQueueState', () => {
  it('reads an unreleased manual posting as held', () => {
    expect(syncQueueState(row())).toBe('held')
  })

  it('reads a released manual posting as sending', () => {
    expect(syncQueueState(row({ releasedAt: '2026-09-01T00:00:00.000Z' }))).toBe('sending')
  })

  it('reads an automatic posting as sending even before a delivery row exists', () => {
    // `deliveryIntent: 'automatic'` releases at plan time, so a null
    // `releasedAt` here only means the worker has not planned it YET. Nobody is
    // being asked to press anything.
    expect(syncQueueState(row({ deliveryIntent: 'automatic' }))).toBe('sending')
  })

  it('reads a legacy posting as sending, never as held', () => {
    expect(syncQueueState(row({ deliveryIntent: null }))).toBe('sending')
  })

  it('reads a refused posting as failed whatever the release says', () => {
    expect(syncQueueState(row({ exportStatus: 'failed' }))).toBe('failed')
    expect(
      syncQueueState(
        row({ exportStatus: 'failed', releasedAt: '2026-09-01T00:00:00.000Z', attempts: 3 })
      )
    ).toBe('failed')
  })
})
