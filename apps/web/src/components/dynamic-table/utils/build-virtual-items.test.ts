// apps/web/src/components/dynamic-table/utils/build-virtual-items.test.ts

import { EMPTY_GROUP_KEY } from '@auxx/lib/resources/grouping/client'
import { describe, expect, it } from 'vitest'
import { buildVirtualItems, type TableVirtualItem, virtualItemSize } from './build-virtual-items'
import { ADD_ROW_HEIGHT, GROUP_HEADER_HEIGHT, ROW_HEIGHT } from './constants'

function rowsFor(keys: Array<string | null>) {
  const rows = keys.map((_, i) => ({ id: `r${i}` }))
  const byId = new Map(rows.map((row, i) => [row.id, keys[i]!]))
  return { rows, keyForRow: (id: string) => byId.get(id) ?? null }
}

function shape(items: TableVirtualItem[]): string[] {
  return items.map((item) => {
    if (item.kind === 'row') return `row:${item.rowIndex}`
    return `${item.kind}:${item.key ?? 'null'}`
  })
}

/** rowTops must agree with summing item heights up to each row item. */
function expectTopsConsistent(items: TableVirtualItem[], rowTops: number[]) {
  let top = 0
  for (const item of items) {
    if (item.kind === 'row') expect(rowTops[item.rowIndex]).toBe(top)
    top += virtualItemSize(item)
  }
}

describe('buildVirtualItems', () => {
  it('without grouping maps rows 1:1 and keeps rowTops[i] === i * ROW_HEIGHT', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }))
    const { items, rowTops } = buildVirtualItems(rows, undefined, { addRow: true })

    expect(items).toHaveLength(50)
    expect(items.every((item, i) => item.kind === 'row' && item.rowIndex === i)).toBe(true)
    rowTops.forEach((top, i) => expect(top).toBe(i * ROW_HEIGHT))
  })

  it('emits a header on every key change and an add row closing each group', () => {
    const { rows, keyForRow } = rowsFor(['a', 'a', 'b', null])
    const { items, rowTops } = buildVirtualItems(
      rows,
      { keyForRow, collapsedKeys: new Set() },
      { addRow: true }
    )

    expect(shape(items)).toEqual([
      'header:a',
      'row:0',
      'row:1',
      'add:a',
      'header:b',
      'row:2',
      'add:b',
      'header:null',
      'row:3',
      'add:null',
    ])
    expect(rowTops[0]).toBe(GROUP_HEADER_HEIGHT)
    expect(rowTops[2]).toBe(2 * GROUP_HEADER_HEIGHT + 2 * ROW_HEIGHT + ADD_ROW_HEIGHT)
    expectTopsConsistent(items, rowTops)
  })

  it('omits add rows when addRow is false', () => {
    const { rows, keyForRow } = rowsFor(['a', 'b'])
    const { items } = buildVirtualItems(
      rows,
      { keyForRow, collapsedKeys: new Set() },
      { addRow: false }
    )
    expect(shape(items)).toEqual(['header:a', 'row:0', 'header:b', 'row:1'])
  })

  it('places collapsed groups at their summary position between loaded groups', () => {
    const { rows, keyForRow } = rowsFor(['a', 'c'])
    const { items, rowTops } = buildVirtualItems(
      rows,
      {
        keyForRow,
        orderedKeys: ['a', 'b', 'c', 'd', null],
        collapsedKeys: new Set(['b', 'd', EMPTY_GROUP_KEY]),
      },
      { addRow: true }
    )

    expect(shape(items)).toEqual([
      'header:a',
      'row:0',
      'add:a',
      'header:b',
      'header:c',
      'row:1',
      'add:c',
      'header:d',
      'header:null',
    ])
    expectTopsConsistent(items, rowTops)
  })

  it('while more rows remain, leaves the last loaded group open and defers later collapsed headers', () => {
    const { rows, keyForRow } = rowsFor(['a', 'b'])
    const grouping = {
      keyForRow,
      orderedKeys: ['a', 'b', 'c', null],
      collapsedKeys: new Set(['c', EMPTY_GROUP_KEY]),
      hasMoreRows: true,
    }
    const { items, rowTops } = buildVirtualItems(rows, grouping, { addRow: true })
    expect(shape(items)).toEqual(['header:a', 'row:0', 'add:a', 'header:b', 'row:1'])
    expectTopsConsistent(items, rowTops)

    const done = buildVirtualItems(rows, { ...grouping, hasMoreRows: false }, { addRow: true })
    expect(shape(done.items)).toEqual([
      'header:a',
      'row:0',
      'add:a',
      'header:b',
      'row:1',
      'add:b',
      'header:c',
      'header:null',
    ])
  })

  it('places a collapsed first group before the first loaded group', () => {
    const { rows, keyForRow } = rowsFor(['b'])
    const { items } = buildVirtualItems(
      rows,
      { keyForRow, orderedKeys: ['a', 'b'], collapsedKeys: new Set(['a']) },
      { addRow: false }
    )
    expect(shape(items)).toEqual(['header:a', 'header:b', 'row:0'])
  })

  it('skips collapsed keys the summary no longer lists', () => {
    const { rows, keyForRow } = rowsFor(['a'])
    const { items } = buildVirtualItems(
      rows,
      { keyForRow, orderedKeys: ['a'], collapsedKeys: new Set(['gone']) },
      { addRow: false }
    )
    expect(shape(items)).toEqual(['header:a', 'row:0'])
  })

  it('appends collapsed keys after the last loaded group when there is no summary order', () => {
    const { rows, keyForRow } = rowsFor(['a'])
    const { items } = buildVirtualItems(
      rows,
      { keyForRow, collapsedKeys: new Set([EMPTY_GROUP_KEY, 'z']) },
      { addRow: false }
    )
    expect(shape(items)).toEqual(['header:a', 'row:0', 'header:z', 'header:null'])
  })

  it('hides still-loaded rows of a collapsed group and pins their tops to its header', () => {
    const { rows, keyForRow } = rowsFor(['a', 'a', 'b'])
    const { items, rowTops } = buildVirtualItems(
      rows,
      { keyForRow, collapsedKeys: new Set(['a']) },
      { addRow: true }
    )

    expect(shape(items)).toEqual(['header:a', 'header:b', 'row:2', 'add:b'])
    expect(rowTops[0]).toBe(0)
    expect(rowTops[1]).toBe(0)
    expect(rowTops[2]).toBe(2 * GROUP_HEADER_HEIGHT)
  })

  it('gives a repeated key a distinct id', () => {
    const { rows, keyForRow } = rowsFor(['a', 'b', 'a'])
    const { items } = buildVirtualItems(
      rows,
      { keyForRow, collapsedKeys: new Set() },
      { addRow: true }
    )
    const ids = items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
