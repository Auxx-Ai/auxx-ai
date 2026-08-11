// apps/web/src/components/fields/group-fields.test.ts
//
// What these tests pin down is the "no stored group position" decision. A group
// renders where its first member sits in `fieldOrder` and nowhere else, so every
// question about group placement — scattered members, empty groups, a field
// dropped into a group's block — has to be answerable from the two arrays alone.
// If any case below needed a third input, the encoding would be wrong.

import { describe, expect, it } from 'vitest'
import {
  assignFieldToGroupInOrder,
  type FieldGroupLike,
  groupFieldOrder,
  moveGroupBlock,
  normalizeGroupContiguity,
  reassignFieldToGroup,
} from './group-fields'

const group = (id: string, fieldIds: string[]): FieldGroupLike => ({
  id,
  label: id.toUpperCase(),
  fieldIds,
})

/** [group id or null, field ids] per section — the shape every assertion below reads. */
const shape = (sections: ReturnType<typeof groupFieldOrder>) =>
  sections.map((section) => [section.group?.id ?? null, section.fieldIds] as const)

const flatten = (sections: ReturnType<typeof groupFieldOrder>) =>
  sections.flatMap((section) => section.fieldIds)

describe('groupFieldOrder', () => {
  it('emits one ungrouped section when there are no groups at all', () => {
    expect(shape(groupFieldOrder({ fieldOrder: ['A', 'B', 'C'], groups: [] }))).toEqual([
      [null, ['A', 'B', 'C']],
    ])
  })

  it('renders a group at the position of its first member', () => {
    // The plan's worked example: fieldOrder [name, email, phone, city] with
    // {phone, city} grouped puts the "Address" header after email.
    const sections = groupFieldOrder({
      fieldOrder: ['name', 'email', 'phone', 'city'],
      groups: [group('g1', ['phone', 'city'])],
    })
    expect(shape(sections)).toEqual([
      [null, ['name', 'email']],
      ['g1', ['phone', 'city']],
    ])
  })

  it('emits no ungrouped section when every field is grouped', () => {
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B', 'C'],
      groups: [group('g1', ['A', 'B']), group('g2', ['C'])],
    })
    expect(shape(sections)).toEqual([
      ['g1', ['A', 'B']],
      ['g2', ['C']],
    ])
  })

  it('gathers scattered members at the first member and skips them later in the walk', () => {
    // g1 owns A and C, which straddle B. The header goes where A is, C is pulled
    // up to it, and B — which was between them — starts a fresh ungrouped run.
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B', 'C', 'D'],
      groups: [group('g1', ['A', 'C'])],
    })
    expect(shape(sections)).toEqual([
      ['g1', ['A', 'C']],
      [null, ['B', 'D']],
    ])
  })

  it('keeps gathered members in fieldOrder order, not fieldIds order', () => {
    // `fieldIds` is a membership set; the array order in it is not display order.
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B', 'C'],
      groups: [group('g1', ['C', 'A', 'B'])],
    })
    expect(shape(sections)).toEqual([['g1', ['A', 'B', 'C']]])
  })

  it('coalesces consecutive ungrouped fields into a single section', () => {
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B', 'G', 'C', 'D'],
      groups: [group('g1', ['G'])],
    })
    expect(shape(sections)).toEqual([
      [null, ['A', 'B']],
      ['g1', ['G']],
      [null, ['C', 'D']],
    ])
  })

  it('emits no empty ungrouped section between two adjacent groups', () => {
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B', 'C', 'D'],
      groups: [group('g1', ['A', 'B']), group('g2', ['C', 'D'])],
    })
    expect(shape(sections)).toEqual([
      ['g1', ['A', 'B']],
      ['g2', ['C', 'D']],
    ])
  })

  it('skips ghost members that no longer exist in fieldOrder', () => {
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'C'],
      groups: [group('g1', ['A', 'deleted', 'C'])],
    })
    expect(shape(sections)).toEqual([['g1', ['A', 'C']]])
  })

  it('drops a group whose members are all ghosts', () => {
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B'],
      groups: [group('g1', ['gone1', 'gone2'])],
    })
    expect(shape(sections)).toEqual([[null, ['A', 'B']]])
  })

  it('resolves a field claimed by two groups to the first group', () => {
    // Malformed input: the field is in both fieldIds arrays. It must appear
    // exactly once, and deterministically.
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B'],
      groups: [group('g1', ['A']), group('g2', ['A', 'B'])],
    })
    expect(shape(sections)).toEqual([
      ['g1', ['A']],
      ['g2', ['B']],
    ])
  })

  it('collapses duplicate ids in fieldOrder to their first occurrence', () => {
    const sections = groupFieldOrder({
      fieldOrder: ['A', 'B', 'A', 'B'],
      groups: [group('g1', ['B'])],
    })
    expect(shape(sections)).toEqual([
      [null, ['A']],
      ['g1', ['B']],
    ])
  })

  it('hides empty groups by default', () => {
    const groups = [group('g1', ['A']), group('empty', []), group('ghosts', ['gone'])]
    expect(shape(groupFieldOrder({ fieldOrder: ['A', 'B'], groups }))).toEqual([
      ['g1', ['A']],
      [null, ['B']],
    ])
  })

  it('appends empty groups at the very end, in groups order, when asked', () => {
    // Edit mode: an empty group has no derived position, so it can only be a
    // drop target pinned after everything that does have one.
    const groups = [group('empty', []), group('g1', ['A']), group('ghosts', ['gone'])]
    const sections = groupFieldOrder({ fieldOrder: ['A', 'B'], groups, includeEmptyGroups: true })
    expect(shape(sections)).toEqual([
      ['g1', ['A']],
      [null, ['B']],
      ['empty', []],
      ['ghosts', []],
    ])
  })

  it('returns [] for an empty fieldOrder, and only empty groups when asked', () => {
    const groups = [group('g1', ['A'])]
    expect(groupFieldOrder({ fieldOrder: [], groups: [] })).toEqual([])
    expect(groupFieldOrder({ fieldOrder: [], groups })).toEqual([])
    expect(shape(groupFieldOrder({ fieldOrder: [], groups, includeEmptyGroups: true }))).toEqual([
      ['g1', []],
    ])
  })

  it('hands back the caller’s own group objects, so headers can read label/collapsed/icon', () => {
    const g1: FieldGroupLike = {
      id: 'g1',
      label: 'Address',
      collapsed: true,
      icon: 'map-pin',
      fieldIds: ['A'],
    }
    const [section] = groupFieldOrder({ fieldOrder: ['A'], groups: [g1] })
    expect(section?.group).toBe(g1)
  })

  it('flattens to a permutation of fieldOrder — no losses, no duplicates', () => {
    const groups = [group('g1', ['C', 'A', 'gone']), group('g2', ['E']), group('empty', [])]
    const fieldOrder = ['A', 'B', 'C', 'D', 'E', 'F']
    for (const includeEmptyGroups of [false, true]) {
      const flat = flatten(groupFieldOrder({ fieldOrder, groups, includeEmptyGroups }))
      expect(new Set(flat).size).toBe(flat.length)
      expect([...flat].sort()).toEqual([...fieldOrder].sort())
    }
  })

  it('does not mutate its inputs', () => {
    const fieldOrder = ['A', 'B', 'C']
    const groups = [group('g1', ['C', 'A'])]
    groupFieldOrder({ fieldOrder, groups, includeEmptyGroups: true })
    expect(fieldOrder).toEqual(['A', 'B', 'C'])
    expect(groups).toEqual([{ id: 'g1', label: 'G1', fieldIds: ['C', 'A'] }])
  })
})

describe('normalizeGroupContiguity', () => {
  it('pulls scattered members up to the group’s first member', () => {
    expect(normalizeGroupContiguity(['A', 'B', 'C', 'D'], [group('g1', ['A', 'C'])])).toEqual([
      'A',
      'C',
      'B',
      'D',
    ])
  })

  it('preserves relative order within the group and among the ungrouped fields', () => {
    expect(
      normalizeGroupContiguity(['x1', 'g2', 'x2', 'g1', 'x3'], [group('g', ['g1', 'g2'])])
    ).toEqual(['x1', 'g2', 'g1', 'x2', 'x3'])
  })

  it('leaves an already-contiguous order untouched', () => {
    const fieldOrder = ['A', 'B', 'C', 'D']
    expect(normalizeGroupContiguity(fieldOrder, [group('g1', ['B', 'C'])])).toEqual(fieldOrder)
  })

  it('is idempotent — a second call is a no-op', () => {
    const cases: Array<{ fieldOrder: string[]; groups: FieldGroupLike[] }> = [
      { fieldOrder: ['A', 'B', 'C', 'D'], groups: [group('g1', ['A', 'C'])] },
      {
        fieldOrder: ['A', 'B', 'C', 'D', 'E'],
        groups: [group('g1', ['B', 'E']), group('g2', ['A', 'D'])],
      },
      { fieldOrder: ['A', 'B'], groups: [group('g1', ['gone']), group('empty', [])] },
      { fieldOrder: ['A', 'B', 'A'], groups: [group('g1', ['B'])] },
      { fieldOrder: [], groups: [group('g1', ['A'])] },
      // Malformed: a field claimed by two groups. First-wins must not oscillate.
      { fieldOrder: ['A', 'B', 'C'], groups: [group('g1', ['B']), group('g2', ['B', 'A'])] },
    ]

    for (const { fieldOrder, groups } of cases) {
      const once = normalizeGroupContiguity(fieldOrder, groups)
      expect(normalizeGroupContiguity(once, groups)).toEqual(once)
    }
  })

  it('returns the same id set it was given, ghosts and duplicates aside', () => {
    const fieldOrder = ['A', 'B', 'C', 'A']
    const normalized = normalizeGroupContiguity(fieldOrder, [group('g1', ['C', 'gone'])])
    expect([...normalized].sort()).toEqual(['A', 'B', 'C'])
  })

  it('does not mutate its inputs', () => {
    const fieldOrder = ['A', 'B', 'C']
    const groups = [group('g1', ['C'])]
    normalizeGroupContiguity(fieldOrder, groups)
    expect(fieldOrder).toEqual(['A', 'B', 'C'])
    expect(groups).toEqual([{ id: 'g1', label: 'G1', fieldIds: ['C'] }])
  })
})

describe('groupFieldOrder ∘ normalizeGroupContiguity', () => {
  it('produces sections whose ids appear in the same relative order as the normalized array', () => {
    // This is the property the drag-and-drop reassignment leans on: after
    // normalising, the flat array IS the render order, so a drop index in the
    // flat array can be read back as a position inside a section.
    const fieldOrder = ['A', 'B', 'C', 'D', 'E', 'F']
    const groups = [group('g1', ['A', 'D']), group('g2', ['C', 'F'])]

    const normalized = normalizeGroupContiguity(fieldOrder, groups)
    expect(normalized).toEqual(['A', 'D', 'B', 'C', 'F', 'E'])

    const sections = groupFieldOrder({ fieldOrder: normalized, groups })
    expect(shape(sections)).toEqual([
      ['g1', ['A', 'D']],
      [null, ['B']],
      ['g2', ['C', 'F']],
      [null, ['E']],
    ])
    expect(flatten(sections)).toEqual(normalized)
  })

  it('gives each group exactly one contiguous run in the normalized array', () => {
    const fieldOrder = ['a1', 'b1', 'a2', 'c1', 'b2', 'a3']
    const groups = [group('ga', ['a1', 'a2', 'a3']), group('gb', ['b1', 'b2'])]
    const normalized = normalizeGroupContiguity(fieldOrder, groups)

    for (const g of groups) {
      const positions = g.fieldIds.map((id) => normalized.indexOf(id)).sort((a, b) => a - b)
      const first = positions[0] as number
      expect(positions).toEqual(positions.map((_, offset) => first + offset))
    }
  })
})

describe('reassignFieldToGroup', () => {
  it('moves a field from one group to another', () => {
    const groups = [group('g1', ['A', 'B']), group('g2', ['C'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'A', groupId: 'g2' })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['B'] },
      { id: 'g2', label: 'G2', fieldIds: ['C', 'A'] },
    ])
  })

  it('ungroups a field when groupId is null', () => {
    const groups = [group('g1', ['A', 'B'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'A', groupId: null })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['B'] },
    ])
  })

  it('adopts a previously ungrouped field', () => {
    const groups = [group('g1', ['A'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'Z', groupId: 'g1' })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['A', 'Z'] },
    ])
  })

  it('never duplicates a field that is already in the target group', () => {
    const groups = [group('g1', ['A', 'B'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'A', groupId: 'g1' })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['A', 'B'] },
    ])
  })

  it('removes the field from every group that claimed it, not just the first', () => {
    // Malformed input, but the write is the natural place to repair it.
    const groups = [group('g1', ['A']), group('g2', ['A', 'B']), group('g3', ['A'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'A', groupId: 'g3' })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: [] },
      { id: 'g2', label: 'G2', fieldIds: ['B'] },
      { id: 'g3', label: 'G3', fieldIds: ['A'] },
    ])
  })

  it('ungroups the field when the target group id does not exist', () => {
    // A group deleted between render and drop must not wedge the panel.
    const groups = [group('g1', ['A', 'B'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'A', groupId: 'missing' })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['B'] },
    ])
  })

  it('claims only the first group when two share an id', () => {
    const groups = [group('dup', ['A']), group('dup', ['B'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'Z', groupId: 'dup' })).toEqual([
      { id: 'dup', label: 'DUP', fieldIds: ['A', 'Z'] },
      { id: 'dup', label: 'DUP', fieldIds: ['B'] },
    ])
  })

  it('preserves the other group fields (label, collapsed, icon)', () => {
    const groups: FieldGroupLike[] = [
      { id: 'g1', label: 'Address', collapsed: true, icon: 'map-pin', fieldIds: ['A'] },
    ]
    expect(reassignFieldToGroup({ groups, fieldId: 'A', groupId: null })).toEqual([
      { id: 'g1', label: 'Address', collapsed: true, icon: 'map-pin', fieldIds: [] },
    ])
  })

  it('returns untouched groups by reference when the assignment is already correct', () => {
    const g1 = group('g1', ['A'])
    const g2 = group('g2', ['B'])
    const input = [g1, g2]
    const next = reassignFieldToGroup({ groups: input, fieldId: 'A', groupId: 'g1' })
    expect(next).not.toBe(input)
    expect(next[0]).toBe(g1)
    expect(next[1]).toBe(g2)
  })

  it('handles an empty groups array and an unknown field', () => {
    expect(reassignFieldToGroup({ groups: [], fieldId: 'A', groupId: 'g1' })).toEqual([])
    expect(reassignFieldToGroup({ groups: [], fieldId: 'A', groupId: null })).toEqual([])
    const groups = [group('g1', ['A'])]
    expect(reassignFieldToGroup({ groups, fieldId: 'unknown', groupId: null })).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['A'] },
    ])
  })

  it('does not mutate its inputs', () => {
    const groups = [group('g1', ['A', 'B']), group('g2', [])]
    reassignFieldToGroup({ groups, fieldId: 'A', groupId: 'g2' })
    expect(groups).toEqual([
      { id: 'g1', label: 'G1', fieldIds: ['A', 'B'] },
      { id: 'g2', label: 'G2', fieldIds: [] },
    ])
  })

  it('is what a drop into a group needs: reassign, then normalise', () => {
    // The drop handler's two steps. `fieldOrder` already carries the new
    // position (dnd-kit moved it); membership then follows, and normalisation
    // makes the group's block contiguous again.
    const groups = [group('g1', ['B', 'C'])]
    const droppedOrder = ['A', 'B', 'Z', 'C', 'D']

    const nextGroups = reassignFieldToGroup({ groups, fieldId: 'Z', groupId: 'g1' })
    expect(normalizeGroupContiguity(droppedOrder, nextGroups)).toEqual(['A', 'B', 'Z', 'C', 'D'])
    expect(shape(groupFieldOrder({ fieldOrder: droppedOrder, groups: nextGroups }))).toEqual([
      [null, ['A']],
      ['g1', ['B', 'Z', 'C']],
      [null, ['D']],
    ])
  })
})

describe('assignFieldToGroupInOrder', () => {
  const G = (): FieldGroupLike[] => [{ id: 'G', label: 'G', fieldIds: ['b', 'c', 'd'] }]

  /** Mirrors what the drop handler does after membership is set. */
  function reorder(
    fieldOrder: string[],
    groups: FieldGroupLike[],
    activeId: string,
    overId: string
  ) {
    const from = fieldOrder.indexOf(activeId)
    const to = fieldOrder.indexOf(overId)
    if (from === -1 || to === -1) return fieldOrder
    const next = [...fieldOrder]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved as string)
    return normalizeGroupContiguity(next, groups)
  }

  it('does not relocate the block when a field joins from ABOVE it', () => {
    // The regression this function exists for: `a` must not be displaced.
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['x', 'a', 'b', 'c', 'd'],
      groups: G(),
      fieldId: 'x',
      groupId: 'G',
    })
    expect(r.fieldOrder).toEqual(['a', 'b', 'c', 'd', 'x'])
  })

  it('does not relocate the block when a field joins from BELOW it', () => {
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['a', 'b', 'c', 'd', 'z'],
      groups: G(),
      fieldId: 'z',
      groupId: 'G',
    })
    expect(r.fieldOrder).toEqual(['a', 'b', 'c', 'd', 'z'])
  })

  it('ungroups a member without moving the remaining block', () => {
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['a', 'b', 'c', 'd'],
      groups: G(),
      fieldId: 'c',
      groupId: null,
    })
    expect(r.fieldOrder).toEqual(['a', 'b', 'd', 'c'])
    expect(r.groups[0]?.fieldIds).toEqual(['b', 'd'])
  })

  it('no-ops the order when the target group has no other surviving members', () => {
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['a', 'x', 'b'],
      groups: [{ id: 'G', label: 'G', fieldIds: [] }],
      fieldId: 'x',
      groupId: 'G',
    })
    expect(r.fieldOrder).toEqual(['a', 'x', 'b'])
    expect(r.groups[0]?.fieldIds).toEqual(['x'])
  })

  it('composes with a follow-up reorder to hit the exact intra-group slot', () => {
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['x', 'a', 'b', 'c', 'd'],
      groups: G(),
      fieldId: 'x',
      groupId: 'G',
    })
    expect(reorder(r.fieldOrder, r.groups, 'x', 'c')).toEqual(['a', 'b', 'x', 'c', 'd'])
    expect(reorder(r.fieldOrder, r.groups, 'x', 'b')).toEqual(['a', 'x', 'b', 'c', 'd'])
  })

  it('leaves the result a fixpoint under re-normalization', () => {
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['x', 'a', 'b', 'c', 'd'],
      groups: G(),
      fieldId: 'x',
      groupId: 'G',
    })
    const after = reorder(r.fieldOrder, r.groups, 'x', 'c')
    expect(normalizeGroupContiguity(after, r.groups)).toEqual(after)
  })

  it('never mutates its inputs', () => {
    const fieldOrder = ['x', 'a', 'b', 'c', 'd']
    const groups = G()
    const orderCopy = [...fieldOrder]
    const groupsCopy = groups.map((g) => ({ ...g, fieldIds: [...g.fieldIds] }))
    assignFieldToGroupInOrder({ fieldOrder, groups, fieldId: 'x', groupId: 'G' })
    expect(fieldOrder).toEqual(orderCopy)
    expect(groups).toEqual(groupsCopy)
  })
})

describe('assignFieldToGroupInOrder — same-group idempotence', () => {
  it('leaves the order untouched when the field is already in the target group', () => {
    // A same-group drag calls assign() then reorder(). If assign relocated the
    // field, the pair would move it twice and land a slot off.
    const fieldOrder = ['a', 'b', 'c']
    const groups: FieldGroupLike[] = [{ id: 'G', label: 'G', fieldIds: ['a', 'b', 'c'] }]
    const r = assignFieldToGroupInOrder({ fieldOrder, groups, fieldId: 'a', groupId: 'G' })
    expect(r.fieldOrder).toEqual(['a', 'b', 'c'])
  })

  it('assign+reorder on a same-group drag lands the exact slot', () => {
    const groups: FieldGroupLike[] = [{ id: 'G', label: 'G', fieldIds: ['a', 'b', 'c'] }]
    const r = assignFieldToGroupInOrder({
      fieldOrder: ['a', 'b', 'c'],
      groups,
      fieldId: 'a',
      groupId: 'G',
    })
    const from = r.fieldOrder.indexOf('a')
    const to = r.fieldOrder.indexOf('c')
    const next = [...r.fieldOrder]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved as string)
    expect(normalizeGroupContiguity(next, r.groups)).toEqual(['b', 'c', 'a'])
  })

  it('leaves the order untouched when ungrouping an already-ungrouped field', () => {
    const fieldOrder = ['a', 'x', 'b']
    const groups: FieldGroupLike[] = [{ id: 'G', label: 'G', fieldIds: ['a', 'b'] }]
    const r = assignFieldToGroupInOrder({ fieldOrder, groups, fieldId: 'x', groupId: null })
    expect(r.fieldOrder).toEqual(normalizeGroupContiguity(fieldOrder, groups))
  })
})

describe('moveGroupBlock', () => {
  // Two blocks with one ungrouped field on either side of gB, so every
  // assertion below also shows where the ungrouped fields ended up.
  const GROUPS = (): FieldGroupLike[] => [group('gA', ['a1', 'a2']), group('gB', ['b1', 'b2'])]
  const ORDER = ['a1', 'a2', 'x', 'b1', 'b2', 'y']

  it('moves a group UP so its block starts at the target group’s position', () => {
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gB',
        overId: 'gA',
        overIsGroup: true,
      })
    ).toEqual(['b1', 'b2', 'a1', 'a2', 'x', 'y'])
  })

  it('moves a group DOWN so its block lands after the target group’s block', () => {
    // The off-by-one: lifting [a1,a2] shifts gB two slots left, so "insert at
    // gB's first member" would put gA back above gB and read as a no-op.
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gA',
        overId: 'gB',
        overIsGroup: true,
      })
    ).toEqual(['x', 'b1', 'b2', 'a1', 'a2', 'y'])
  })

  it('moves the middle group of three to either end', () => {
    const groups = [group('g1', ['p']), group('g2', ['q1', 'q2']), group('g3', ['r'])]
    const fieldOrder = ['p', 'q1', 'q2', 'r']
    const up = { fieldOrder, groups, groupId: 'g2', overId: 'g1', overIsGroup: true }
    const down = { fieldOrder, groups, groupId: 'g2', overId: 'g3', overIsGroup: true }
    expect(moveGroupBlock(up)).toEqual(['q1', 'q2', 'p', 'r'])
    expect(moveGroupBlock(down)).toEqual(['p', 'r', 'q1', 'q2'])
  })

  it('is a no-op when a group is dropped on ITSELF', () => {
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gA',
        overId: 'gA',
        overIsGroup: true,
      })
    ).toEqual(ORDER)
  })

  it('is a no-op when a group is dropped on one of its OWN members', () => {
    for (const overId of ['a1', 'a2']) {
      expect(
        moveGroupBlock({
          fieldOrder: ORDER,
          groups: GROUPS(),
          groupId: 'gA',
          overId,
          overIsGroup: false,
        })
      ).toEqual(ORDER)
    }
  })

  it('snaps to the target group’s boundary when dropped on a field INSIDE it', () => {
    // Dropping on b1 or b2 must give the same answer as dropping on gB — never
    // [x, b1, a1, a2, b2, y], which would split gB's block.
    const onGroup = moveGroupBlock({
      fieldOrder: ORDER,
      groups: GROUPS(),
      groupId: 'gA',
      overId: 'gB',
      overIsGroup: true,
    })
    for (const overId of ['b1', 'b2']) {
      expect(
        moveGroupBlock({
          fieldOrder: ORDER,
          groups: GROUPS(),
          groupId: 'gA',
          overId,
          overIsGroup: false,
        })
      ).toEqual(onGroup)
    }
  })

  it('snaps to the boundary in the upward direction too', () => {
    for (const overId of ['a1', 'a2']) {
      expect(
        moveGroupBlock({
          fieldOrder: ORDER,
          groups: GROUPS(),
          groupId: 'gB',
          overId,
          overIsGroup: false,
        })
      ).toEqual(['b1', 'b2', 'a1', 'a2', 'x', 'y'])
    }
  })

  it('inserts exactly at an ungrouped field when dragged UP onto it', () => {
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gB',
        overId: 'x',
        overIsGroup: false,
      })
    ).toEqual(['a1', 'a2', 'b1', 'b2', 'x', 'y'])
  })

  it('inserts after an ungrouped field when dragged DOWN onto it', () => {
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gA',
        overId: 'x',
        overIsGroup: false,
      })
    ).toEqual(['x', 'a1', 'a2', 'b1', 'b2', 'y'])
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gA',
        overId: 'y',
        overIsGroup: false,
      })
    ).toEqual(['x', 'b1', 'b2', 'y', 'a1', 'a2'])
  })

  it('keeps the ungrouped fields in their relative order', () => {
    const groups = [group('gA', ['a1', 'a2']), group('gB', ['b1'])]
    const fieldOrder = ['x1', 'a1', 'a2', 'x2', 'b1', 'x3']
    const moved = moveGroupBlock({
      fieldOrder,
      groups,
      groupId: 'gA',
      overId: 'gB',
      overIsGroup: true,
    })
    expect(moved).toEqual(['x1', 'x2', 'b1', 'a1', 'a2', 'x3'])
    expect(moved.filter((id) => id.startsWith('x'))).toEqual(['x1', 'x2', 'x3'])
  })

  it('gathers a scattered block before moving it', () => {
    // Malformed (non-normalised) input: gA straddles x. The whole membership
    // moves, and the result comes back contiguous.
    const groups = [group('gA', ['a1', 'a2']), group('gB', ['b1'])]
    expect(
      moveGroupBlock({
        fieldOrder: ['a1', 'x', 'a2', 'b1'],
        groups,
        groupId: 'gA',
        overId: 'gB',
        overIsGroup: true,
      })
    ).toEqual(['x', 'b1', 'a1', 'a2'])
  })

  it('moves only the fields the first-claiming group owns', () => {
    // `shared` is claimed by both; groupFieldOrder gives it to gA, so gB's block
    // is just b2 and the two functions cannot disagree about what moved.
    const groups = [group('gA', ['shared', 'a2']), group('gB', ['shared', 'b2'])]
    expect(
      moveGroupBlock({
        fieldOrder: ['shared', 'a2', 'b2'],
        groups,
        groupId: 'gB',
        overId: 'gA',
        overIsGroup: true,
      })
    ).toEqual(['b2', 'shared', 'a2'])
  })

  it('collapses duplicate ids in fieldOrder', () => {
    const groups = [group('gA', ['a1']), group('gB', ['b1'])]
    expect(
      moveGroupBlock({
        fieldOrder: ['a1', 'x', 'b1', 'a1', 'x'],
        groups,
        groupId: 'gA',
        overId: 'gB',
        overIsGroup: true,
      })
    ).toEqual(['x', 'b1', 'a1'])
  })

  it('no-ops on an unknown groupId', () => {
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'deleted',
        overId: 'gB',
        overIsGroup: true,
      })
    ).toEqual(ORDER)
  })

  it('no-ops on an unknown overId, whether it is read as a group or a field', () => {
    for (const overIsGroup of [true, false]) {
      expect(
        moveGroupBlock({
          fieldOrder: ORDER,
          groups: GROUPS(),
          groupId: 'gA',
          overId: 'deleted',
          overIsGroup,
        })
      ).toEqual(ORDER)
    }
  })

  it('no-ops when overIsGroup is false but overId names a group', () => {
    // A mislabelled drop must not be read as a field id that happens to miss.
    expect(
      moveGroupBlock({
        fieldOrder: ORDER,
        groups: GROUPS(),
        groupId: 'gA',
        overId: 'gB',
        overIsGroup: false,
      })
    ).toEqual(ORDER)
  })

  it('no-ops when the moving group has no surviving members', () => {
    const groups = [group('ghosts', ['gone']), group('empty', []), group('gB', ['b1'])]
    for (const groupId of ['ghosts', 'empty']) {
      expect(
        moveGroupBlock({
          fieldOrder: ['x', 'b1', 'y'],
          groups,
          groupId,
          overId: 'gB',
          overIsGroup: true,
        })
      ).toEqual(['x', 'b1', 'y'])
    }
  })

  it('no-ops when the TARGET group has no surviving members', () => {
    // An empty group is pinned at the end by render convention only; it has no
    // position in fieldOrder to land against.
    const groups = [group('gA', ['a1', 'a2']), group('empty', []), group('ghosts', ['gone'])]
    for (const overId of ['empty', 'ghosts']) {
      expect(
        moveGroupBlock({
          fieldOrder: ['a1', 'a2', 'x'],
          groups,
          groupId: 'gA',
          overId,
          overIsGroup: true,
        })
      ).toEqual(['a1', 'a2', 'x'])
    }
  })

  it('returns [] for an empty fieldOrder', () => {
    expect(
      moveGroupBlock({
        fieldOrder: [],
        groups: GROUPS(),
        groupId: 'gA',
        overId: 'gB',
        overIsGroup: true,
      })
    ).toEqual([])
  })

  it('always returns a permutation of the deduplicated input, and never throws', () => {
    const groups = [
      group('gA', ['a1', 'a2']),
      group('gB', ['b1', 'b2']),
      group('empty', []),
      group('ghosts', ['gone']),
    ]
    const fieldOrder = ['a1', 'x', 'a2', 'b1', 'y', 'b2']
    const groupIds = ['gA', 'gB', 'empty', 'ghosts', 'deleted']
    const fieldIds = ['a1', 'a2', 'b1', 'b2', 'x', 'y', 'gone', 'unknown']

    for (const groupId of groupIds) {
      for (const overId of [...groupIds, ...fieldIds]) {
        for (const overIsGroup of [true, false]) {
          const moved = moveGroupBlock({ fieldOrder, groups, groupId, overId, overIsGroup })
          expect(new Set(moved).size).toBe(moved.length)
          expect([...moved].sort()).toEqual([...fieldOrder].sort())
          // Every result is already contiguous — re-normalising is a no-op.
          expect(normalizeGroupContiguity(moved, groups)).toEqual(moved)
        }
      }
    }
  })

  it('agrees with groupFieldOrder about where the moved block renders', () => {
    const groups = GROUPS()
    const moved = moveGroupBlock({
      fieldOrder: ORDER,
      groups,
      groupId: 'gA',
      overId: 'gB',
      overIsGroup: true,
    })
    expect(
      groupFieldOrder({ fieldOrder: moved, groups }).map((s) => [s.group?.id ?? null, s.fieldIds])
    ).toEqual([
      [null, ['x']],
      ['gB', ['b1', 'b2']],
      ['gA', ['a1', 'a2']],
      [null, ['y']],
    ])
  })

  it('never mutates its inputs', () => {
    const fieldOrder = [...ORDER]
    const groups = GROUPS()
    const orderCopy = [...fieldOrder]
    const groupsCopy = groups.map((g) => ({ ...g, fieldIds: [...g.fieldIds] }))
    moveGroupBlock({ fieldOrder, groups, groupId: 'gA', overId: 'gB', overIsGroup: true })
    expect(fieldOrder).toEqual(orderCopy)
    expect(groups).toEqual(groupsCopy)
  })
})
