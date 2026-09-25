// packages/lib/src/accounting/work-items/__tests__/codes.test.ts

import { describe, expect, it } from 'vitest'
import {
  isWorkItemCode,
  nextAttemptDelayMs,
  WORK_ITEM_CODES,
  type WorkItemCode,
  workItemSentence,
  workItemSeverity,
  workItemStatus,
} from '../codes'

const CODES = Object.keys(WORK_ITEM_CODES) as WorkItemCode[]

describe('the reason-code vocabulary', () => {
  it.each(CODES)('%s has a sentence and a severity', (code) => {
    expect(['info', 'warning', 'error']).toContain(workItemSeverity(code))
    expect(['waiting', 'blocked', 'warning', 'skipped', 'rejected']).toContain(workItemStatus(code))
    const bare = workItemSentence(code)
    const keyed = workItemSentence(code, {
      role: 'clearing',
      railId: 'pg_1',
      glAccountId: 'gl_1',
      periodKey: '2026-09',
      externalRef: '#1001',
      detail: { message: 'The poster said so.', currency: 'USD' },
    })
    for (const sentence of [bare, keyed]) {
      expect(sentence.length).toBeGreaterThan(10)
      expect(sentence).toMatch(/[.)]$/)
    }
  })

  it('severity decides the retry: info and error back off to a safety net, the rest never retry', () => {
    for (const code of CODES) {
      const delay = nextAttemptDelayMs(code, 1)
      const status = workItemStatus(code)
      if (status === 'skipped' || status === 'rejected' || status === 'warning')
        expect(delay).toBeNull()
      else expect(delay).toBeGreaterThan(0)
    }
    expect(nextAttemptDelayMs('ORDER_NOT_FOUND', 1)).toBeLessThan(
      nextAttemptDelayMs('ROLE_UNMAPPED', 1) ?? 0
    )
  })

  it('a transient code doubles from a minute to a six-hour cap', () => {
    expect(nextAttemptDelayMs('TRANSIENT_ERROR', 1)).toBe(60_000)
    expect(nextAttemptDelayMs('TRANSIENT_ERROR', 2)).toBe(120_000)
    expect(nextAttemptDelayMs('TRANSIENT_ERROR', 40)).toBe(6 * 60 * 60 * 1000)
  })

  it('names the role and the order it waits on', () => {
    expect(workItemSentence('ROLE_UNMAPPED', { role: 'clearing' })).toContain("'clearing'")
    expect(workItemSentence('ORDER_NOT_FOUND', { externalRef: '#1001' })).toContain('#1001')
    expect(workItemSentence('GATEWAY_UNMAPPED', { externalRef: 'paypal' })).toContain("'paypal'")
    expect(workItemSentence('GATEWAY_UNMAPPED')).toContain('store feed')
  })

  it('names the connector a channel memo waits on, and its pending money', () => {
    expect(workItemSeverity('MEMO_INPUT_INCOMPLETE')).toBe('info')
    expect(workItemStatus('MEMO_INPUT_INCOMPLETE')).toBe('waiting')
    expect(
      workItemSentence('MEMO_INPUT_INCOMPLETE', {
        detail: { connector: 'Shopify', pendingRelations: [{ recordId: 'cm_1' }] },
      })
    ).toBe('Its data from Shopify is not complete yet. It issues when the sync links it.')
    expect(workItemSentence('MEMO_INPUT_INCOMPLETE', { detail: { moneyPending: true } })).toBe(
      'Its refund is still pending at the connector. It issues once the money settles.'
    )
  })

  it("names a part by the group's current label over the name stamped on the row", () => {
    expect(
      workItemSentence('STANDARD_COST_MISSING', {
        refLabel: 'The Attic-Lift',
        detail: { partName: 'Old name' },
      })
    ).toMatch(/^The Attic-Lift has no standard cost/)
    expect(workItemSentence('STANDARD_COST_MISSING', { detail: { partName: 'Old name' } })).toMatch(
      /^Old name has no standard cost/
    )
  })

  it('waits on evidence, and blocks on a gateway or an ownership conflict', () => {
    expect(workItemSeverity('EVIDENCE_PENDING')).toBe('info')
    expect(workItemSeverity('GATEWAY_UNMAPPED')).toBe('error')
    expect(workItemSeverity('OWNERSHIP_CONFLICT')).toBe('error')
  })

  it('treats an unknown code as the generic refusal rather than throwing', () => {
    expect(isWorkItemCode('NOT_A_CODE')).toBe(false)
    expect(workItemSeverity('NOT_A_CODE')).toBe('error')
    expect(workItemSentence('NOT_A_CODE', { detail: { message: 'raw words' } })).toBe('raw words')
  })
})
