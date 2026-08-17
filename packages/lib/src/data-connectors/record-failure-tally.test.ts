// packages/lib/src/data-connectors/record-failure-tally.test.ts
// The line between "bad data, keep going" and "bad configuration, stop now".
//
// Both halves matter. Trip too eagerly and a source with a normal amount of junk in it
// (Quo's address book carries 57 unparseable phone numbers in 4222) stops importing for
// no reason. Trip too late and a mapping pointing at a field that no longer exists
// produces a `partial` run that wrote nothing across thousands of records, burying the
// one fact anybody needed under thousands of identical errors.

import { describe, expect, it } from 'vitest'
import {
  newRecordFailureTally,
  systemicFailureReason,
  tallyFailure,
  tallySuccess,
} from './record-failure-tally'

/** Drive n outcomes through a fresh tally. `fail` decides each one. */
function run(n: number, fail: (i: number) => boolean, message = 'boom') {
  const tally = newRecordFailureTally()
  for (let i = 0; i < n; i++) {
    if (fail(i)) tallyFailure(tally, message)
    else tallySuccess(tally)
  }
  return tally
}

describe('bad data keeps the sync running', () => {
  it('does not trip on the real Quo shape — 57 bad numbers in 4222 records', () => {
    // Spread the failures the way real junk data is spread, not in a block.
    const tally = run(4222, (i) => i % 74 === 0)
    expect(tally.failed).toBeGreaterThan(50)
    expect(systemicFailureReason(tally)).toBeNull()
  })

  it('does not trip on a long clean run with occasional failures', () => {
    expect(systemicFailureReason(run(500, (i) => i % 20 === 0))).toBeNull()
  })

  it('does not trip on a short run that is mostly failures — too small to judge', () => {
    // 3 of 5 failed is 60%, but 5 records is not evidence of anything.
    expect(systemicFailureReason(run(5, (i) => i < 3))).toBeNull()
  })

  it('a success clears the consecutive streak', () => {
    // Padded with successes so the RATE arm stays quiet and this tests only the streak.
    const tally = newRecordFailureTally()
    for (let i = 0; i < 60; i++) tallySuccess(tally)
    for (let i = 0; i < 24; i++) tallyFailure(tally, 'boom')
    tallySuccess(tally)
    expect(tally.consecutive).toBe(0)
    expect(systemicFailureReason(tally)).toBeNull()
  })
})

describe('bad configuration stops the sync', () => {
  it('trips once 25 records fail in a row', () => {
    const reason = systemicFailureReason(run(25, () => true))
    expect(reason).not.toBeNull()
    expect(reason).toContain('configuration problem')
    expect(reason).toContain('25 records in a row failed')
  })

  it('trips on a majority failure rate once the sample is big enough', () => {
    // 60% failing, never 25 in a row — the consecutive arm alone would miss this.
    const tally = run(50, (i) => i % 5 !== 0)
    expect(tally.consecutive).toBeLessThan(25)
    expect(systemicFailureReason(tally)).toContain('of 50 records failed')
  })

  it('names the dominant cause so the run row is actionable', () => {
    const tally = newRecordFailureTally()
    for (let i = 0; i < 30; i++) tallyFailure(tally, 'field "Quo Company" not found on contact')
    expect(systemicFailureReason(tally)).toContain('field "Quo Company" not found on contact')
    expect(systemicFailureReason(tally)).toContain('30×')
  })

  it('picks the MOST common cause, not the first', () => {
    const tally = newRecordFailureTally()
    tallyFailure(tally, 'rare one-off')
    for (let i = 0; i < 30; i++) tallyFailure(tally, 'the real problem')
    expect(systemicFailureReason(tally)).toContain('the real problem')
  })
})

describe('boundary', () => {
  /**
   * Isolate the CONSECUTIVE arm: lead with enough successes that the failure rate
   * stays a minority, so only the streak can trip it. (A bare run of 24 failures is
   * 24/24 = 100% and trips the rate arm instead — correctly, but it tests the other
   * arm.)
   */
  function streak(length: number) {
    const tally = newRecordFailureTally()
    for (let i = 0; i < 60; i++) tallySuccess(tally)
    for (let i = 0; i < length; i++) tallyFailure(tally, 'boom')
    return tally
  }

  it('holds at 24 consecutive and trips at 25', () => {
    expect(streak(24).failed / streak(24).attempted).toBeLessThan(0.5)
    expect(systemicFailureReason(streak(24))).toBeNull()
    expect(systemicFailureReason(streak(25))).toContain('25 records in a row failed')
  })

  it('needs a strict majority — exactly half is not systemic', () => {
    const half = run(40, (i) => i % 2 === 0)
    expect(half.failed / half.attempted).toBe(0.5)
    expect(systemicFailureReason(half)).toBeNull()
  })

  it('an all-failing run trips immediately on rate once past the minimum sample', () => {
    expect(systemicFailureReason(run(19, () => true))).toBeNull()
    expect(systemicFailureReason(run(20, () => true))).not.toBeNull()
  })
})
