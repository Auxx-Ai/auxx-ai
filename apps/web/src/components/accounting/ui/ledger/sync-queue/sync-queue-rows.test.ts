// apps/web/src/components/accounting/ui/ledger/sync-queue/sync-queue-rows.test.ts

import type { SyncQueueRow } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import {
  filterSyncQueue,
  refusalTooltipLines,
  refusedReasonSummary,
  SYNC_QUEUE_TAB_LABELS,
  syncQueuePeriods,
  syncQueueRailSentence,
  syncQueueStateSentence,
  tallySyncQueue,
} from './sync-queue-rows'

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

const HELD = row({ glPostingId: 'gl_held' })
const SENDING = row({ glPostingId: 'gl_sending', releasedAt: '2026-09-01T00:00:00.000Z' })
const FAILED = row({
  glPostingId: 'gl_failed',
  periodKey: '2026-07',
  exportStatus: 'failed',
  attempts: 2,
  failureReason: 'The period is closed',
})

describe('tallySyncQueue', () => {
  it('counts the three states separately, never as one pile', () => {
    // 🛑 53 §7.2.2. `held` and `sending` are both `exportStatus: 'pending'`;
    // collapsing them makes a healthy hold read as a backlog of errors.
    expect(tallySyncQueue([HELD, HELD, SENDING, FAILED])).toEqual({
      held: 2,
      sending: 1,
      failed: 1,
      total: 4,
    })
  })

  it('answers zero for an undefined read rather than throwing', () => {
    expect(tallySyncQueue(undefined)).toEqual({ held: 0, sending: 0, failed: 0, total: 0 })
  })
})

describe('filterSyncQueue', () => {
  it('gives each tab only its own rows', () => {
    const rows = [HELD, SENDING, FAILED]
    expect(filterSyncQueue(rows, 'held')).toEqual([HELD])
    expect(filterSyncQueue(rows, 'sending')).toEqual([SENDING])
    expect(filterSyncQueue(rows, 'failed')).toEqual([FAILED])
  })

  it('leaves `all` alone - it is the backlog itself', () => {
    const rows = [HELD, SENDING, FAILED]
    expect(filterSyncQueue(rows, 'all')).toBe(rows)
  })
})

describe('syncQueuePeriods', () => {
  // 🛑 The period filter is built from the rows, NOT from the month the ledger
  // toolbar resolved (53 §7.2.4). The queue spans months by definition, and a
  // filter seeded from one month would hide everything held before it.
  it('lists each period once, in the order the rows arrive', () => {
    expect(syncQueuePeriods([HELD, FAILED, SENDING])).toEqual(['2026-08', '2026-07'])
  })
})

describe('the copy is provider-agnostic (D14a)', () => {
  // 🔌 Nothing above the `AccountingProvider` seam may name a vendor. The label
  // arrives from `useAccountingProviderStatus`, and for an org that has
  // connected nothing it is `UNKNOWN_PROVIDER_LABEL` - so a sentence that
  // hardcoded "QuickBooks" would name a product the reader has never installed.
  const LABEL = 'Xero'

  it('never says QuickBooks in a state sentence', () => {
    for (const state of ['held', 'sending', 'failed'] as const) {
      const sentence = syncQueueStateSentence(state, LABEL)
      expect(sentence).not.toMatch(/quickbooks/i)
    }
    expect(syncQueueStateSentence('held', LABEL)).toContain(LABEL)
    expect(syncQueueStateSentence('sending', LABEL)).toContain(LABEL)
    expect(syncQueueStateSentence('failed', LABEL)).toContain(LABEL)
  })

  it('never says QuickBooks in a tab label', () => {
    for (const label of Object.values(SYNC_QUEUE_TAB_LABELS)) {
      expect(label).not.toMatch(/quickbooks/i)
    }
  })

  it('never says QuickBooks in the rail sentence', () => {
    const sentence = syncQueueRailSentence(tallySyncQueue([HELD, SENDING, FAILED]), LABEL)
    expect(sentence).toBe('1 ready to sync, 1 sending, 1 refused to Xero.')
  })

  // 🔌 The refusal STRING is the provider's own words and passes through
  // verbatim; the sentence wrapped around it is ours, and it takes the label.
  it('never says QuickBooks in the row tooltip', () => {
    const lines = refusalTooltipLines(FAILED, 'Coverage has a gap', LABEL)
    for (const line of lines) expect(line).not.toMatch(/quickbooks/i)
    expect(lines.join(' ')).toContain(LABEL)
  })
})

describe('refusalTooltipLines', () => {
  // 🛑 The reason moved OFF the row text and into a tooltip, so these are the
  // only assertions left that either string reaches a reader at all.
  it('says nothing when there is nothing to say', () => {
    expect(refusalTooltipLines(HELD, undefined, 'Xero')).toEqual([])
  })

  it('carries the persisted provider refusal', () => {
    expect(refusalTooltipLines(FAILED, undefined, 'Xero')).toEqual([
      'Xero refused it. The period is closed',
    ])
  })

  it('carries an in-session plan refusal, which the row itself never records', () => {
    expect(refusalTooltipLines(HELD, 'Coverage has a gap', 'Xero')).toEqual([
      'The last sync did not release it. Coverage has a gap',
    ])
  })

  it('puts both on ONE icon, the action you just took first', () => {
    // Two amber dots side by side read as a rendering fault. One icon, two
    // sentences, and the in-session one leads because it is about the button
    // the reader just pressed.
    expect(refusalTooltipLines(FAILED, 'Coverage has a gap', 'Xero')).toEqual([
      'The last sync did not release it. Coverage has a gap',
      'Xero refused it. The period is closed',
    ])
  })
})

describe('refusedReasonSummary', () => {
  // 🔑 D17 applied to the banner: the queue is the list, so the banner counts.
  it('quotes a single shared reason once, because that is the common case', () => {
    expect(refusedReasonSummary([FAILED, FAILED, FAILED])).toBe('The period is closed')
  })

  it('counts distinct reasons rather than enumerating rows', () => {
    const other = row({ exportStatus: 'failed', failureReason: 'Product Revenue is not mapped' })
    expect(refusedReasonSummary([FAILED, other, FAILED])).toBe(
      '2 different reasons, each on its own row in the sync queue.'
    )
  })

  it('says so when nothing recorded a reason at all', () => {
    const silent = row({ exportStatus: 'failed', failureReason: null })
    expect(refusedReasonSummary([silent, silent])).toBe(
      'No reason was recorded. The sync queue shows where each one stands.'
    )
  })
})

describe('syncQueueRailSentence', () => {
  // ⚠️ A rail line that renders identically every day teaches people to stop
  // reading the rail. An empty queue gets no line, not "0 waiting".
  it('says nothing at all about an empty queue', () => {
    expect(syncQueueRailSentence(tallySyncQueue([]), 'Xero')).toBeNull()
  })

  it('names only the states that have rows', () => {
    expect(syncQueueRailSentence(tallySyncQueue([HELD, HELD]), 'Xero')).toBe(
      '2 ready to sync to Xero.'
    )
  })
})
