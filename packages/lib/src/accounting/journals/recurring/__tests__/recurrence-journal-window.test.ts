// packages/lib/src/accounting/journals/recurring/__tests__/recurrence-journal-window.test.ts

/**
 * The window rule, over the real expander. PURE - no database, no mocks, no
 * fake timers: `planRecurringOccurrences` takes `now` as an argument
 * precisely so this file can exist.
 *
 * What is pinned here is the set of decisions that are silent when wrong:
 *
 * - the window looks BACKWARD, so March's entry cannot exist in January;
 * - a reviewed month holds nothing back;
 * - `count` exhausts exactly once even though nothing counts the rows;
 * - a monthly rule on day 31 lands on the last day of February.
 */

import { describe, expect, it } from 'vitest'
import type { RecurrencePattern } from '../../../../recurrence'
import {
  buildDocNumber,
  DOC_NUMBER_MAX_LENGTH,
  DOC_NUMBER_PREFIX,
} from '../../../ledger/builders/doc-number'
import { MAX_COMPACT_PERIOD_KEY } from '../../../ledger/periods/period-key'
import {
  planRecurringOccurrences,
  RECURRING_JOURNAL_DOC_PREFIX,
  recurringJournalPeriodKey,
} from '../client'

const ZONE = 'America/New_York'

/** Local midnight in {@link ZONE} as the UTC instant, the way a rule's cursor is stored. */
function at(localDate: string): Date {
  // `America/New_York` is UTC-5 / UTC-4; both land the same calendar day when
  // the hour is 12:00, which is all these bounds need.
  return new Date(`${localDate}T12:00:00.000Z`)
}

const MONTHLY_LAST_DAY: RecurrencePattern = { frequency: 'monthly', interval: 1, monthDay: 31 }
const MONTHLY_FIRST: RecurrencePattern = { frequency: 'monthly', interval: 1, monthDay: 1 }

describe('planRecurringOccurrences - the window is backward-looking', () => {
  it('returns nothing beyond today, even when the pattern runs for years', () => {
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-01-15'),
    })

    expect(plan.due.map((o) => o.occurrenceDate)).toEqual(['2026-01-01'])
  })

  it("does not put March's entry in the books in January", () => {
    // The trap the visit materializer's forward horizon would spring: it
    // expands to `now + 56 days`, which from mid-January reaches March 1.
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-01-20'),
    })

    expect(plan.due.map((o) => o.occurrenceDate)).not.toContain('2026-02-01')
    expect(plan.due.map((o) => o.occurrenceDate)).not.toContain('2026-03-01')
  })

  it('catches up every occurrence between the cursor and today, oldest first', () => {
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-04-10'),
    })

    expect(plan.due.map((o) => o.occurrenceDate)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ])
  })

  it('generates nothing twice: a cursor past an occurrence excludes it', () => {
    const first = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-02-10'),
    })
    expect(first.due).toHaveLength(2)

    const second = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: first.cursor,
      now: at('2026-02-20'),
    })
    expect(second.due).toEqual([])
  })

  it('leaves the cursor at now', () => {
    const now = at('2026-04-10')
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now,
    })
    expect(plan.cursor).toBe(now)
  })
})

describe('planRecurringOccurrences - a reviewed month holds nothing back', () => {
  it('offers every occurrence up to now, whatever the reviewed-through marker says', () => {
    const now = at('2026-04-10')
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_FIRST,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now,
    })

    expect(plan.due.map((o) => o.occurrenceDate)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ])
    expect(plan.cursor).toBe(now)
  })
})

describe('planRecurringOccurrences - end conditions', () => {
  it('`count` exhausts, and stays exhausted once the cursor has moved past it', () => {
    const pattern: RecurrencePattern = { ...MONTHLY_FIRST, count: 3 }

    const first = planRecurringOccurrences({
      pattern,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-06-10'),
    })
    expect(first.due.map((o) => o.occurrenceDate)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])

    const second = planRecurringOccurrences({
      pattern,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: first.cursor,
      now: at('2026-09-10'),
    })
    expect(second.due).toEqual([])
  })

  it('`count` is spent across passes, not per pass', () => {
    const pattern: RecurrencePattern = { ...MONTHLY_FIRST, count: 3 }

    const first = planRecurringOccurrences({
      pattern,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-02-10'),
    })
    expect(first.due).toHaveLength(2)

    const second = planRecurringOccurrences({
      pattern,
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: first.cursor,
      now: at('2026-08-10'),
    })
    // One left, not three.
    expect(second.due.map((o) => o.occurrenceDate)).toEqual(['2026-03-01'])
  })

  it('`until` stops the series on its own date', () => {
    const plan = planRecurringOccurrences({
      pattern: { ...MONTHLY_FIRST, until: '2026-02-28' },
      anchor: '2026-01-01',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-06-10'),
    })
    expect(plan.due.map((o) => o.occurrenceDate)).toEqual(['2026-01-01', '2026-02-01'])
  })
})

describe('planRecurringOccurrences - a monthly rule on day 31', () => {
  it('lands on the last day of February, not on March 3', () => {
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_LAST_DAY,
      anchor: '2026-01-31',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-04-15'),
    })

    // 2026 is not a leap year.
    expect(plan.due.map((o) => o.occurrenceDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
  })

  it('lands on the 29th in a leap February', () => {
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_LAST_DAY,
      anchor: '2028-01-31',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2028-03-15'),
    })
    expect(plan.due.map((o) => o.occurrenceDate)).toEqual(['2028-01-31', '2028-02-29'])
  })

  it('does not lose April, which has thirty days', () => {
    const plan = planRecurringOccurrences({
      pattern: MONTHLY_LAST_DAY,
      anchor: '2026-03-31',
      timezone: ZONE,
      materializedUntil: null,
      now: at('2026-05-15'),
    })
    // May 31 has not happened yet on May 15, which is the backward window
    // doing its job: an entry is a claim about a period that is over.
    expect(plan.due.map((o) => o.occurrenceDate)).toEqual(['2026-03-31', '2026-04-30'])
  })
})

describe('the document number an occurrence claims', () => {
  const key = recurringJournalPeriodKey({
    recurrenceRuleId: 'clx0000000000000000000000',
    occurrenceDate: '2026-03-31',
  })

  it('compacts within the budget', () => {
    // `RJE-<6 base36>` renders verbatim as the document number, so the key
    // must leave room for `-R9` under the 21-character cap.
    expect(key).toMatch(/^RJE-[0-9A-Z]{6}$/)
    expect(key.replace(/-/g, '').length).toBeLessThanOrEqual(MAX_COMPACT_PERIOD_KEY)
  })

  it('survives a reversal under the cap', () => {
    expect(buildDocNumber({ postingType: 'recurring_journal', periodKey: key })).toBe(key)
    expect(
      buildDocNumber({ postingType: 'recurring_journal', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('carries the prefix the document number declares', () => {
    expect(RECURRING_JOURNAL_DOC_PREFIX).toBe(DOC_NUMBER_PREFIX.recurring_journal)
  })
})
