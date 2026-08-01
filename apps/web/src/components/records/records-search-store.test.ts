// apps/web/src/components/records/records-search-store.test.ts
//
// Plan decision 0.3 on the client: the search bar is a TWO-part control —
// structured conditions narrow, and the free-standing typed text IS the search.
// `splitRecordSearch` is the one place that separation is made, so these tests
// are what stop the typed text from silently sliding back into the filter
// pipeline (where it compiled to `displayName ILIKE '%q%'`).
//
// No heuristic is involved and none should ever be added: the shell CREATED the
// free-text condition from `freeTextField` (`RECORDS_FREE_TEXT_FIELD`), so it is
// identifiable by construction.

import { describe, expect, it } from 'vitest'
import type { SearchCondition } from '~/components/searchbar/types'
import { RECORDS_FREE_TEXT_FIELD, splitRecordSearch } from './records-search-store'

const condition = (over: Partial<SearchCondition>): SearchCondition =>
  ({ id: 'c1', fieldId: 'status', operator: 'equals', value: 'open', ...over }) as SearchCondition

const freeText = (value: unknown) =>
  condition({ id: 'ft', fieldId: RECORDS_FREE_TEXT_FIELD, operator: 'contains', value })

describe('splitRecordSearch', () => {
  it('returns nothing for an empty bar', () => {
    expect(splitRecordSearch([])).toEqual({ search: undefined, group: null })
  })

  it('lifts the free-text condition OUT of the group and into `search`', () => {
    const r = splitRecordSearch([freeText('acme berlin')])

    expect(r.search).toBe('acme berlin')
    // Critical: not also left behind as a condition, or the ranked predicate and
    // the ILIKE would both run and the search would narrow twice.
    expect(r.group).toBeNull()
  })

  it('keeps narrowing conditions in the group alongside the search', () => {
    const r = splitRecordSearch([
      condition({ id: 'c1', fieldId: 'status', value: 'open' }),
      freeText('acme'),
    ])

    expect(r.search).toBe('acme')
    expect(r.group?.conditions).toHaveLength(1)
    expect(r.group?.conditions[0].fieldId).toBe('status')
    expect(r.group?.logicalOperator).toBe('AND')
  })

  it('drops empty and undefined condition values, as the group builder does', () => {
    const r = splitRecordSearch([
      condition({ id: 'c1', fieldId: 'status', value: '' }),
      condition({ id: 'c2', fieldId: 'owner', value: undefined }),
      freeText('acme'),
    ])

    expect(r.search).toBe('acme')
    expect(r.group).toBeNull()
  })

  it('treats a whitespace-only query as no search at all', () => {
    expect(splitRecordSearch([freeText('   ')]).search).toBeUndefined()
  })

  it('ignores a non-string free-text value rather than coercing it', () => {
    // Defensive: `addCondition` merges array values for repeat field ids, so a
    // free-text slot could in principle hold something that is not a string.
    expect(splitRecordSearch([freeText(['a', 'b'])]).search).toBeUndefined()
  })
})
