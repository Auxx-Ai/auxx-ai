// apps/web/src/components/mrp/ui/all-parts/all-parts-rows.test.ts
import { describe, expect, it } from 'vitest'
import type { MrpListRow } from '../rows/mrp-row'
import { groupAllPartsByFinishedGood, NO_FINISHED_GOOD_ID } from './all-parts-rows'

function item(
  partId: string,
  finishedGoodIds: string[],
  finishedGoodNames = finishedGoodIds
): MrpListRow {
  return {
    partId,
    partName: partId,
    finishedGoodIds,
    finishedGoodNames,
    flags: [],
    supplyType: 'bought',
    leadTimeSource: 'none',
  } as unknown as MrpListRow
}

const today = new Date('2026-09-24T00:00:00Z')

describe('groupAllPartsByFinishedGood', () => {
  it('heads a section with the finished good, repeats shared parts, and ends with the rest', () => {
    const items = [
      item('motor', ['liftA', 'liftB']),
      item('liftA', ['liftA']),
      item('bolt', []),
      item('frame', ['liftB'], ['Lift B']),
    ]
    const { rows, partIdByRowId, sectionIds } = groupAllPartsByFinishedGood(items, today)

    expect(sectionIds).toEqual(['liftA', 'liftB', NO_FINISHED_GOOD_ID])
    expect(rows.map((row) => row.kind)).toEqual(['section', 'section', 'section'])
    expect(rows[0]?.children?.map((row) => row.id)).toEqual(['liftA/motor'])
    expect(rows[1]?.label).toBe('liftB')
    expect(rows[1]?.children?.map((row) => partIdByRowId.get(row.id))).toEqual(['motor', 'frame'])
    expect(rows[2]?.children?.map((row) => row.id)).toEqual([`${NO_FINISHED_GOOD_ID}/bolt`])
    // Loaded head opens its part; a name-only head and the rest section do not.
    expect(partIdByRowId.get('liftA')).toBe('liftA')
    expect(partIdByRowId.has('liftB')).toBe(false)
    expect(partIdByRowId.has(NO_FINISHED_GOOD_ID)).toBe(false)
  })

  it('keeps a finished good out of the rest section when it heads one', () => {
    const { sectionIds } = groupAllPartsByFinishedGood(
      [item('liftA', []), item('motor', ['liftA'])],
      today
    )
    expect(sectionIds).toEqual(['liftA'])
  })
})
