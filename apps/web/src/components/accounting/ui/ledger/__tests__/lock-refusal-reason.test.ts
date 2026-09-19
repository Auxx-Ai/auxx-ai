// apps/web/src/components/accounting/ui/ledger/__tests__/lock-refusal-reason.test.ts
//
// Why the Lock button is refused, and what it tells the operator to do about it.
//
// 🛑 This is about the SENTENCE, not the gate. The gate itself was always
// correct; what it carried was no reason at all, and the only nearby copy
// described the state ("Open. The entry can still be reversed and re-entered")
// while naming no remedy.
//
// The close posts nothing, so the refusal is never "post the month-end entry" —
// that remedy pointed at a control that could be disabled with nothing to post.
// It is the outstanding work `readCloseBlockers` found, and the remedy is to
// clear it.

import { describe, expect, it } from 'vitest'
import { lockRefusalReason } from '../format'

const CLEAR = {
  periodLabel: 'January 2026',
  isChecking: false,
  blockerCount: 0,
}

describe('lockRefusalReason', () => {
  it('offers Lock on a month with nothing outstanding', () => {
    expect(lockRefusalReason(CLEAR)).toBeNull()
  })

  /**
   * Neither offer nor refuse until the checklist has been read: a refusal built
   * from an empty in-flight list would name a number that is about to change,
   * and an offer would let the month lock over work nobody has looked for yet.
   */
  it('says it is still checking rather than answering early', () => {
    const reason = lockRefusalReason({ ...CLEAR, isChecking: true })
    expect(reason).toContain('Checking')
    expect(reason).toContain('January 2026')
  })

  it('refuses an outstanding month and names the remedy', () => {
    const reason = lockRefusalReason({ ...CLEAR, blockerCount: 3 })
    expect(reason).toContain('January 2026')
    expect(reason).toContain('3 things')
    // The remedy, which is the half the old copy was missing entirely.
    expect(reason).toContain('Clear the list above')
  })

  it('counts one blocker in words rather than as a bare 1', () => {
    expect(lockRefusalReason({ ...CLEAR, blockerCount: 1 })).toContain('one thing')
  })

  /**
   * The regression guard the two branches were written for. `Post it under
   * Entries above` pointed at a button that can read "There is nothing to post"
   * and be disabled, so no refusal may ask for a post.
   */
  it('never tells the operator to post an entry', () => {
    for (const params of [CLEAR, { ...CLEAR, isChecking: true }, { ...CLEAR, blockerCount: 2 }]) {
      expect(lockRefusalReason(params) ?? '').not.toContain('Post it')
    }
  })

  it('carries whatever period label it is given', () => {
    expect(lockRefusalReason({ ...CLEAR, periodLabel: 'March 2027', blockerCount: 1 })).toContain(
      'March 2027'
    )
  })
})
