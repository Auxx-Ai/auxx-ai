// apps/web/src/components/records/nav/record-list-context-store.test.ts
//
// The store is written on EVERY table render (the publisher effect runs whenever
// filters/sorting/ids change identity), so the de-dupe in `capture` is what keeps
// it from re-notifying every subscriber on a no-op. These tests pin that, plus
// the two rules the rest of the feature leans on: entries are keyed per
// definition, and a changed query REPLACES rather than merges.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecordListContext,
  getRecordListContext,
  type RecordListDescriptor,
  useRecordListContextStore,
} from './record-list-context-store'

const DEF_A = 'edf_contact00000000000000000'
const DEF_B = 'edf_ticket000000000000000000'

function descriptor(overrides: Partial<RecordListDescriptor> = {}): RecordListDescriptor {
  return {
    entityDefinitionId: DEF_A,
    filters: [],
    sorting: [],
    tableId: `entity-${DEF_A}`,
    viewId: 'tv_default',
    label: 'All contacts',
    ...overrides,
  }
}

const capture = (d: RecordListDescriptor, ids: string[]) =>
  useRecordListContextStore.getState().capture(d, ids)

beforeEach(() => {
  clearRecordListContext()
})

describe('capture', () => {
  it('stores the descriptor and ids for a definition', () => {
    capture(descriptor(), ['a', 'b', 'c'])

    const entry = getRecordListContext(DEF_A)
    expect(entry?.ids).toEqual(['a', 'b', 'c'])
    expect(entry?.descriptor.label).toBe('All contacts')
  })

  it('is a no-op when nothing moved — same query, no new ids', () => {
    capture(descriptor(), ['a', 'b', 'c'])
    const first = getRecordListContext(DEF_A)

    capture(descriptor(), ['a', 'b', 'c'])

    // Identity, not equality: a fresh object here would re-render every consumer
    // on every table render.
    expect(getRecordListContext(DEF_A)).toBe(first)
  })

  it('is a no-op when the incoming ids are a truncation of what we hold', () => {
    capture(descriptor(), ['a', 'b', 'c'])
    const first = getRecordListContext(DEF_A)

    // A remount that has only rendered its first page must not shrink the list
    // out from under the arrows.
    capture(descriptor(), ['a'])

    expect(getRecordListContext(DEF_A)).toBe(first)
  })

  it('writes when the surface has loaded more rows', () => {
    capture(descriptor(), ['a', 'b'])
    capture(descriptor(), ['a', 'b', 'c', 'd'])

    expect(getRecordListContext(DEF_A)?.ids).toEqual(['a', 'b', 'c', 'd'])
  })

  it('replaces rather than merges when the filters change', () => {
    capture(descriptor(), ['a', 'b', 'c'])
    capture(
      descriptor({
        filters: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [{ id: 'c1', fieldId: 'fld_x', operator: 'is', value: 'open' }],
          },
        ],
      }),
      ['x', 'y']
    )

    // A different query is a different list. Carrying `a`/`b`/`c` across would
    // let the arrows walk rows the filter excludes.
    expect(getRecordListContext(DEF_A)?.ids).toEqual(['x', 'y'])
  })

  it('writes when only the label changed — the popover header would go stale', () => {
    capture(descriptor(), ['a'])
    capture(descriptor({ label: 'My hot leads' }), ['a'])

    expect(getRecordListContext(DEF_A)?.descriptor.label).toBe('My hot leads')
  })

  it('keys entries per definition', () => {
    capture(descriptor(), ['a', 'b'])
    capture(descriptor({ entityDefinitionId: DEF_B, tableId: `entity-${DEF_B}` }), ['t1'])

    // Opening a ticket from the contacts table must not inherit the contacts list.
    expect(getRecordListContext(DEF_A)?.ids).toEqual(['a', 'b'])
    expect(getRecordListContext(DEF_B)?.ids).toEqual(['t1'])
  })
})

describe('clearRecordListContext', () => {
  it('drops every definition', () => {
    capture(descriptor(), ['a'])
    capture(descriptor({ entityDefinitionId: DEF_B, tableId: `entity-${DEF_B}` }), ['t1'])

    clearRecordListContext()

    expect(getRecordListContext(DEF_A)).toBeUndefined()
    expect(getRecordListContext(DEF_B)).toBeUndefined()
  })
})

describe('getRecordListContext', () => {
  it('returns undefined for an unknown or absent definition', () => {
    expect(getRecordListContext(undefined)).toBeUndefined()
    expect(getRecordListContext('edf_nope')).toBeUndefined()
  })
})
