// apps/web/src/components/accounting/ui/ledger/__tests__/lock-refusal-reason.test.ts
//
// Why the Lock button is refused, and what it tells the operator to do about it.
//
// 🛑 This is about the SENTENCE, not the gate. The gate itself was always
// correct; what it carried was no reason at all, and the only nearby copy
// described the state ("Open. The entry can still be reversed and re-entered")
// while naming no remedy and implying an entry that may not exist.
//
// The case that matters is `nothing_to_close`. Such a month has no month-end
// entry to post and never will, so the postable month's remedy - "post it, then
// lock" - sends the operator to a control that reads "There is nothing to post"
// and is itself disabled. A wrong remedy is worse than silence, which is the
// whole reason the two branches exist.

import { describe, expect, it } from 'vitest'
import { lockRefusalReason } from '../format'

const OPEN = {
  periodLabel: 'January 2026',
  isPostedPeriod: false,
  justPosted: false,
  isNothingToClose: false,
}

describe('lockRefusalReason', () => {
  it('offers Lock on a posted month', () => {
    expect(lockRefusalReason({ ...OPEN, isPostedPeriod: true })).toBeNull()
  })

  /**
   * `justPosted` is why Lock works immediately after posting, before the period
   * query has refetched and moved `state` off `'open'`. Dropping it would make
   * the button dead until a reload.
   */
  it('offers Lock right after a post in this session, before the query catches up', () => {
    expect(lockRefusalReason({ ...OPEN, justPosted: true })).toBeNull()
  })

  it('refuses an open month and names the remedy', () => {
    const reason = lockRefusalReason(OPEN)
    expect(reason).toContain('January 2026')
    expect(reason).toContain('no month-end entry yet')
    // The remedy, which is the half the old copy was missing entirely.
    expect(reason).toContain('Post it under Entries above')
  })

  /**
   * 🛑 The defect this function was extracted for. A month showing $1.3m of
   * posted fulfillment still refuses to lock, because only `month_end_inventory`
   * rows count - so the sentence has to say that the other entries do not close
   * the month, or the operator reads the button as broken.
   */
  it('says that the other entries this month do not close it', () => {
    expect(lockRefusalReason(OPEN)).toContain('do not close it')
  })

  describe('a nothing_to_close month', () => {
    const nothing = { ...OPEN, isNothingToClose: true }

    it('explains that there is nothing to post, rather than asking for a post', () => {
      const reason = lockRefusalReason(nothing)
      expect(reason).toContain('Nothing moved in January 2026')
      expect(reason).toContain('Move to the next month')
    })

    /**
     * The actual regression guard. `Post it under Entries above` points at a
     * button that reads "There is nothing to post" and is disabled, so this
     * month must never be given that remedy.
     */
    it('never tells the operator to post an entry that cannot be built', () => {
      expect(lockRefusalReason(nothing)).not.toContain('Post it')
    })

    it('still yields to a posted month', () => {
      expect(lockRefusalReason({ ...nothing, isPostedPeriod: true })).toBeNull()
    })
  })

  it('carries whatever period label it is given', () => {
    expect(lockRefusalReason({ ...OPEN, periodLabel: 'March 2027' })).toContain('March 2027')
  })
})
