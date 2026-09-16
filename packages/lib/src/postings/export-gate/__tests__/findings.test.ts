// packages/lib/src/postings/export-gate/__tests__/findings.test.ts
//
// The pure half of the gate: which posting types are a claim about which source
// stream, and how findings become the one sentence a refusal is reported as.
//
// Everything here is total - no database, no clock - which is the whole reason
// these live in `findings.ts` rather than inside the read.

import { describe, expect, it } from 'vitest'
import { describeIncompleteRevenue } from '../../close-blockers'
import {
  CLAIMED_SOURCE_STREAMS,
  claimedSourceStreams,
  describeBankCoverageGap,
  describeUnbalancedEntry,
  describeUnreviewedBankLines,
  exportGateLead,
  exportGateMessage,
  exportGateStatus,
  liftCloseBlockerItem,
} from '../findings'
import type { ExportGateFinding } from '../types'

const BLOCK: ExportGateFinding = {
  key: 'unposted_shipments',
  check: 'source_completeness',
  severity: 'block',
  label: '2 shipments are not posted',
  remedy: 'Post the fulfillments for August 2026 with the posting dialog.',
  ref: '2026-08',
}

const WARN: ExportGateFinding = {
  key: 'bank_unreviewed',
  check: 'bank_reconciliation',
  severity: 'warn',
  label: '3 lines are still unreviewed on Chase 1234',
  remedy:
    'Clear the review queue for Chase 1234 so the cash in your books is the cash in the bank.',
}

describe('claimedSourceStreams', () => {
  it('claims shipments for a fulfillment summary and both memo counts for a credit memo', () => {
    expect(claimedSourceStreams('fulfillment')).toEqual(['unposted_shipments'])
    expect(claimedSourceStreams('credit_memo')).toEqual([
      'draft_channel_memos',
      'unposted_credit_memos',
    ])
  })

  it('claims nothing for an entry a person wrote or that is 1:1 with one event', () => {
    // The table's omissions are decisions, not gaps - see its JSDoc. A manual
    // journal blocked because somebody else's shipments are unposted is how an
    // operator learns to route around a gate.
    for (const type of [
      'manual_journal',
      'opening_balance',
      'recurring_journal',
      'payout',
      'payment',
      'vendor_bill',
      'invoice_issued',
      'provider_sync',
    ] as const) {
      expect(claimedSourceStreams(type)).toEqual([])
    }
  })

  it('never claims a month-end entry, which the close already refuses on the same counts', () => {
    expect(CLAIMED_SOURCE_STREAMS.month_end_deferral).toBeUndefined()
    expect(CLAIMED_SOURCE_STREAMS.month_end_reversal).toBeUndefined()
    expect(CLAIMED_SOURCE_STREAMS.month_end_inventory).toBeUndefined()
  })
})

describe('liftCloseBlockerItem', () => {
  it('copies the close console label and remedy verbatim', () => {
    const [item] = describeIncompleteRevenue({
      periodKey: '2026-08',
      shipments: 2,
      draftChannelMemos: 0,
      unpostedCreditMemos: 0,
    })
    expect(item).toBeDefined()
    const finding = liftCloseBlockerItem(item!, 'source_completeness', 'block')

    // 🛑 The point of the whole module. Two screens, one condition, one wording.
    expect(finding.label).toBe(item!.label)
    expect(finding.remedy).toBe(item!.remedy)
    expect(finding.key).toBe('unposted_shipments')
    expect(finding.severity).toBe('block')
    // `describeIncompleteRevenue` was handed the MONTH, so the ref is the month.
    expect(finding.ref).toBe('2026-08')
    expect(finding.count).toBe(2)
  })

  it('omits count and ref rather than carrying undefined', () => {
    const finding = liftCloseBlockerItem(
      { key: 'unmapped_role', label: 'AR', remedy: 'Map it.' },
      'source_completeness',
      'warn'
    )
    expect('count' in finding).toBe(false)
    expect('ref' in finding).toBe(false)
  })
})

describe('describeUnbalancedEntry', () => {
  it('distinguishes an entry that does not tie from a header with no lines', () => {
    expect(describeUnbalancedEntry({ docNumber: 'JE-1', hasLines: true }).label).toContain(
      'does not tie'
    )
    expect(describeUnbalancedEntry({ docNumber: 'JE-1', hasLines: false }).label).toContain(
      'no lines'
    )
  })

  it('is always a block, because the entry itself is wrong', () => {
    expect(describeUnbalancedEntry({ docNumber: 'JE-1', hasLines: true }).severity).toBe('block')
  })
})

describe('the bank findings', () => {
  it('warn rather than block, and name the account in the remedy', () => {
    const unreviewed = describeUnreviewedBankLines({
      bankAccountId: 'ba_1',
      bankAccountName: 'Chase 1234',
      unreviewedCount: 3,
      oldestUnreviewedDate: '2026-03-02',
    })
    expect(unreviewed.severity).toBe('warn')
    expect(unreviewed.label).toBe(
      '3 lines are still unreviewed on Chase 1234, the oldest dated 2026-03-02'
    )
    expect(unreviewed.remedy).toContain('Chase 1234')
    expect(unreviewed.ref).toBe('ba_1')

    const gap = describeBankCoverageGap({
      bankAccountId: 'ba_1',
      bankAccountName: 'Chase 1234',
      gapCount: 1,
    })
    expect(gap.severity).toBe('warn')
    expect(gap.label).toBe('Chase 1234 has 1 gap in its feed')
  })

  it('singularises one line and drops the date clause when there is none', () => {
    const one = describeUnreviewedBankLines({
      bankAccountId: 'ba_1',
      bankAccountName: 'Chase 1234',
      unreviewedCount: 1,
      oldestUnreviewedDate: null,
    })
    expect(one.label).toBe('1 line is still unreviewed on Chase 1234')
  })
})

describe('exportGateStatus', () => {
  it('is clear with no findings, warn with only warnings, block if anything blocks', () => {
    expect(exportGateStatus([])).toBe('clear')
    expect(exportGateStatus([WARN])).toBe('warn')
    expect(exportGateStatus([WARN, BLOCK])).toBe('block')
  })
})

describe('exportGateMessage', () => {
  it('says nothing when there is nothing to say', () => {
    expect(
      exportGateMessage({ docNumber: 'FUL-2026-08', periodKey: '2026-08', findings: [] })
    ).toBe(null)
  })

  it('names the month the counts were actually about, not the posting key', () => {
    // A DAY-keyed summary is checked against the month containing it. The lead
    // has to say "August 2026", not "2026-08-18", or the operator goes looking
    // at one day for a count that spans the month.
    const message = exportGateMessage({
      docNumber: 'FUL-2026-08-18',
      periodKey: '2026-08-18',
      findings: [BLOCK],
    })
    expect(message).toBe(
      'FUL-2026-08-18 was not sent: August 2026 still holds work that would change it. ' +
        '2 shipments are not posted. Post the fulfillments for August 2026 with the posting dialog.'
    )
  })

  it('leads with the entry when the entry itself is wrong', () => {
    const unbalanced = describeUnbalancedEntry({ docNumber: 'JE-9', hasLines: true })
    const message = exportGateMessage({
      docNumber: 'JE-9',
      periodKey: 'po_abc',
      findings: [unbalanced, BLOCK],
    })
    expect(message).toContain('JE-9 was not sent: the entry itself is wrong.')
  })

  it('projects every finding, in order, as label then remedy', () => {
    const message = exportGateMessage({
      docNumber: 'FUL-2026-08',
      periodKey: '2026-08',
      findings: [BLOCK, WARN],
    })
    expect(message).toContain(`${BLOCK.label}. ${BLOCK.remedy}`)
    expect(message).toContain(`${WARN.label}. ${WARN.remedy}`)
  })

  it('still speaks when nothing blocks, so a caveat can be shown without refusing', () => {
    const lead = exportGateLead({
      docNumber: 'FUL-2026-08',
      periodKey: '2026-08',
      findings: [WARN],
    })
    expect(lead).toBe('FUL-2026-08 can be sent, but not everything behind it is settled yet.')
  })
})
