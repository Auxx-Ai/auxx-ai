// packages/lib/src/reconcilers/__tests__/resolve-parents-by-relation.test.ts
//
// Four of the five parent resolutions across the shipped consumers were this
// function copied verbatim with a different systemAttribute, so a regression here
// is four subsystems wide: the vendor bill of a bill line, the work order of a
// source line, the order of an order line, the purchase order of a PO line.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  readFieldRelations: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../field-values/read-field-scalars', () => ({
  readFieldRelations: h.readFieldRelations,
}))

import { resolveParentsByRelation } from '../parent-reconciler'

const ORG = 'org_1'
const ATTR = 'vendor_bill_line_vendor_bill'

/** `childId -> fieldId -> parentId`, the shape `readFieldRelations` returns. */
function rels(entries: Array<[string, string]>) {
  return new Map(entries.map(([child, parent]) => [child, new Map([['f-rel', parent]])]))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue({ [ATTR]: { id: 'f-rel' } })
  h.readFieldRelations.mockResolvedValue(new Map())
})

describe('resolveParentsByRelation', () => {
  it('reads every child in ONE relation query', async () => {
    h.readFieldRelations.mockResolvedValue(
      rels([
        ['c-1', 'p-1'],
        ['c-2', 'p-2'],
      ])
    )

    const parents = await resolveParentsByRelation(ORG, ATTR as never, ['c-1', 'c-2'])

    expect(h.readFieldRelations).toHaveBeenCalledTimes(1)
    expect(h.readFieldRelations.mock.calls[0]![2]).toEqual(['c-1', 'c-2'])
    expect(parents).toEqual(['p-1', 'p-2'])
  })

  it('returns one entry per child, so two children of one parent yield it twice', async () => {
    h.readFieldRelations.mockResolvedValue(
      rels([
        ['c-1', 'p-1'],
        ['c-2', 'p-1'],
      ])
    )

    // Duplicates are intentional here — `defineParentReconciler` dedupes. Filtering
    // twice would just hide which child contributed what.
    expect(await resolveParentsByRelation(ORG, ATTR as never, ['c-1', 'c-2'])).toEqual([
      'p-1',
      'p-1',
    ])
  })

  it('drops an orphaned child rather than yielding a hole', async () => {
    h.readFieldRelations.mockResolvedValue(rels([['c-2', 'p-2']]))

    expect(await resolveParentsByRelation(ORG, ATTR as never, ['c-1', 'c-2'])).toEqual(['p-2'])
  })

  it('preserves the order the children were given', async () => {
    h.readFieldRelations.mockResolvedValue(
      rels([
        ['c-2', 'p-2'],
        ['c-1', 'p-1'],
      ])
    )

    expect(await resolveParentsByRelation(ORG, ATTR as never, ['c-1', 'c-2'])).toEqual([
      'p-1',
      'p-2',
    ])
  })

  it('yields nothing, and queries nothing, when the org lacks the field', async () => {
    h.bySystemAttributes.mockResolvedValue({ [ATTR]: null })

    expect(await resolveParentsByRelation(ORG, ATTR as never, ['c-1'])).toEqual([])
    // An unmigrated org has nothing to reconcile. Failing loudly would turn every
    // write in that org into a logged error.
    expect(h.readFieldRelations).not.toHaveBeenCalled()
  })
})
