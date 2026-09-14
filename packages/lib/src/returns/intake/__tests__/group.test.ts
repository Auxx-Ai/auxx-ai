// packages/lib/src/returns/intake/__tests__/group.test.ts
//
// `group.ts` is pure, so this file has NO mocks, no `db` double and no clock
// (plans/money/tasks/57 §5, build order step 4: `folders/tree.ts` is the model).
// Every assertion below is a business rule, not a query result.

import { describe, expect, it } from 'vitest'
import type { ReturnIntakeLabel } from '../client'
import { groupLabels } from '../group'

const ACME = 'def_contact:contact_acme' as ReturnIntakeLabel['confirmedContactRecordId']
const BETA = 'def_contact:contact_beta' as ReturnIntakeLabel['confirmedContactRecordId']
const ORDER_1 = 'def_order:order_1' as ReturnIntakeLabel['confirmedOrderRecordId']
const ORDER_2 = 'def_order:order_2' as ReturnIntakeLabel['confirmedOrderRecordId']

function label(id: string, partial: Partial<ReturnIntakeLabel> = {}): ReturnIntakeLabel {
  return {
    id,
    fileRef: `field-${id}`,
    fileName: `${id}.jpg`,
    transcription: null,
    error: null,
    candidates: [],
    bestTier: 'none',
    looksOutbound: false,
    confirmedContactRecordId: null,
    confirmedOrderRecordId: null,
    confirmedUnidentified: false,
    ...partial,
  }
}

describe('groupLabels — the key is (contact, order)', () => {
  it('one confirmed label is one group', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.contactRecordId).toBe(ACME)
    expect(groups[0]?.orderRecordId).toBe(ORDER_1)
    expect(groups[0]?.labelIds).toEqual(['l1'])
  })

  it('three labels, one customer, one order — one group with three parcels', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l3', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.labelIds).toEqual(['l1', 'l2', 'l3'])
  })

  it('🛑 same customer, two orders — TWO groups, because the order is the grain', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_2 }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.orderRecordId)).toEqual([ORDER_1, ORDER_2])
    expect(groups.map((g) => g.labelIds)).toEqual([['l1'], ['l2']])
  })

  it('two customers are two groups even on the same order id', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedContactRecordId: BETA, confirmedOrderRecordId: ORDER_1 }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.contactRecordId)).toEqual([ACME, BETA])
  })

  it('a confirmed customer with no order is its own group, and collects its parcels', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME }),
      label('l2', { confirmedContactRecordId: ACME }),
      label('l3', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ orderRecordId: null, labelIds: ['l1', 'l2'] })
    expect(groups[1]).toMatchObject({ orderRecordId: ORDER_1, labelIds: ['l3'] })
  })
})

describe('groupLabels — unidentified and undecided', () => {
  it('🛑 two unidentified labels are TWO groups, never one', () => {
    const groups = groupLabels([
      label('l1', { confirmedUnidentified: true }),
      label('l2', { confirmedUnidentified: true }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.labelIds)).toEqual([['l1'], ['l2']])
    expect(groups.every((g) => g.contactRecordId === null)).toBe(true)
    expect(groups[0]?.id).not.toBe(groups[1]?.id)
  })

  it('🛑 an undecided label is excluded entirely — grouping on a guess is forbidden', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      // Candidates, but nobody has answered yet.
      label('l2', { bestTier: 'name_place' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.labelIds).toEqual(['l1'])
  })

  it('a draft where nothing has been answered yields no groups at all', () => {
    expect(groupLabels([label('l1'), label('l2')])).toEqual([])
  })

  it('an explicit "not one of ours" wins over a contact id that is also set', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedUnidentified: true }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.contactRecordId).toBeNull()
  })

  it('empty in, empty out', () => {
    expect(groupLabels([])).toEqual([])
  })
})

describe('groupLabels — ordering and ids', () => {
  it('groups come back in first-label upload order, interleaving and all', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: BETA, confirmedOrderRecordId: ORDER_2 }),
      label('l2', { confirmedUnidentified: true }),
      label('l3', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l4', { confirmedContactRecordId: BETA, confirmedOrderRecordId: ORDER_2 }),
    ])

    expect(groups.map((g) => g.labelIds)).toEqual([['l1', 'l4'], ['l2'], ['l3']])
  })

  it('ids are derived from the key, so two calls on the same input agree exactly', () => {
    const labels = [
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedUnidentified: true }),
    ]

    expect(groupLabels(labels).map((g) => g.id)).toEqual(groupLabels(labels).map((g) => g.id))
  })

  it('an id survives a later label joining the same group', () => {
    const first = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
    ])
    const second = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
    ])

    expect(second[0]?.id).toBe(first[0]?.id)
  })

  it('an id survives one more label being confirmed elsewhere in the draft', () => {
    const before = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2'),
    ])
    const after = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedContactRecordId: BETA }),
    ])

    expect(after[0]?.id).toBe(before[0]?.id)
    expect(after).toHaveLength(2)
  })

  it('🛑 a contact-only group and a contact+order group never collide on an id', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME }),
      label('l2', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
    ])

    expect(new Set(groups.map((g) => g.id)).size).toBe(2)
  })

  it('ids do not use `:`, which would be ambiguous against a RecordId', () => {
    const groups = groupLabels([
      label('l1', { confirmedContactRecordId: ACME, confirmedOrderRecordId: ORDER_1 }),
      label('l2', { confirmedUnidentified: true }),
    ])

    for (const group of groups) {
      expect(group.id.split('|')[0]).toMatch(/^(grp|unid)$/)
    }
  })

  it('mutating a returned group does not reach back into the input labels', () => {
    const labels = [label('l1', { confirmedContactRecordId: ACME })]
    const groups = groupLabels(labels)
    groups[0]?.labelIds.push('l9')

    expect(groupLabels(labels)[0]?.labelIds).toEqual(['l1'])
  })
})
