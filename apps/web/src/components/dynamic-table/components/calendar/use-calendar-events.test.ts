// apps/web/src/components/dynamic-table/components/calendar/use-calendar-events.test.ts
//
// The calendar is the one surface that drains MULTIPLE `listFiltered` pages for
// a single view, so it is the one place the dropped-filter report has to be
// FOLDED rather than read. Getting that fold wrong reproduces, in the notice
// itself, exactly the kind of wrong number the notice exists to report.

import type { DroppedFilterNotice } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { mergeDroppedFilterPages } from './use-calendar-events'

const notice = (n: number): DroppedFilterNotice => ({
  conditionId: `c${n}`,
  fieldRef: `contact:cf_${n}`,
  operator: 'is',
  reason: 'unresolved-field-or-operator',
})

describe('mergeDroppedFilterPages', () => {
  it('reports nothing when every page was clean', () => {
    expect(mergeDroppedFilterPages([{}, {}, {}])).toEqual({
      droppedConditions: [],
      droppedConditionCount: 0,
    })
  })

  it('counts one ignored filter ONCE across identical pages', () => {
    // The expected production shape: same filters, same fields, same drop on
    // every page. Concatenating would say "4 filters were ignored" for one
    // filter, purely because the month needed four pages.
    const page = { droppedConditions: [notice(1)], droppedConditionCount: 1 }

    expect(mergeDroppedFilterPages([page, page, page, page])).toEqual({
      droppedConditions: [notice(1)],
      droppedConditionCount: 1,
    })
  })

  it('unions distinct conditions if pages ever disagree', () => {
    // They should not — but the fold must not silently lose one if they do.
    const merged = mergeDroppedFilterPages([
      { droppedConditions: [notice(1)], droppedConditionCount: 1 },
      { droppedConditions: [notice(2)], droppedConditionCount: 1 },
    ])

    expect(merged.droppedConditions).toEqual([notice(1), notice(2)])
  })

  it('takes the MAX count, not the sum — each page total is already uncapped', () => {
    const merged = mergeDroppedFilterPages([
      { droppedConditions: [notice(1)], droppedConditionCount: 3 },
      { droppedConditions: [notice(1)], droppedConditionCount: 3 },
    ])

    expect(merged.droppedConditionCount).toBe(3)
  })

  it('keeps a count that exceeds the delivered array — the server cap survives the fold', () => {
    // 25 delivered, 40 dropped, on every page. The uncapped total has to come
    // through, or the notice undercounts exactly where it matters most.
    const delivered = Array.from({ length: 25 }, (_, i) => notice(i))
    const page = { droppedConditions: delivered, droppedConditionCount: 40 }

    const merged = mergeDroppedFilterPages([page, page])

    expect(merged.droppedConditions).toHaveLength(25)
    expect(merged.droppedConditionCount).toBe(40)
  })
})
