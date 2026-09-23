// packages/lib/src/accounting/connect-and-go/__tests__/bank-account-plan.test.ts

import { describe, expect, it } from 'vitest'
import {
  type BankAccountPlanInput,
  parseLast4FromName,
  planBankAccounts,
} from '../bank-account-plan'

type Chart = BankAccountPlanInput['chart'][number]
type Bank = BankAccountPlanInput['bankAccounts'][number]

const gl = (id: string, name: string, over: Partial<Chart> = {}): Chart => ({
  id,
  name,
  subtype: 'bank',
  isActive: true,
  ...over,
})
const bank = (id: string, over: Partial<Bank> = {}): Bank => ({
  id,
  name: `Bank ${id}`,
  last4: null,
  type: 'depository',
  glAccountId: null,
  connectorId: null,
  archivedAt: null,
  ...over,
})
const feed = (id: string, last4: string | null, over: Partial<Bank> = {}) =>
  bank(id, { connectorId: `conn_${id}`, last4, ...over })

function plan(input: Partial<BankAccountPlanInput>) {
  return planBankAccounts({
    chart: [],
    providerAccountIds: new Map(),
    bankAccounts: [],
    ...input,
  })
}

describe('parseLast4FromName', () => {
  it.each([
    ['Chase Checking (1234)', '1234'],
    ['BUSINESS CHECKING (5678) - 1', '5678'],
    ['Checking x4321', '4321'],
    ['Checking ...9876', '9876'],
    ['Savings *1111', '1111'],
    ['Operating ending in 2222', '2222'],
    ['Checking', null],
    ['Checking 2024', null],
    ['Chase (1234) and Wells (5678)', null],
  ])('%s -> %s', (name, expected) => {
    expect(parseLast4FromName(name)).toBe(expected)
  })
})

describe('planBankAccounts', () => {
  it('proposes a record for each provider-linked bank account without one', () => {
    const result = plan({
      chart: [
        gl('gl_chk', 'Chase Checking (1234)'),
        gl('gl_unlinked', 'Petty Bank'),
        gl('gl_ar', 'A/R', { subtype: 'accounts_receivable' }),
      ],
      providerAccountIds: new Map([
        ['gl_chk', 'p_35'],
        ['gl_ar', 'p_84'],
      ]),
    })
    expect(result.proposals).toEqual([
      {
        key: 'create:gl_chk',
        kind: 'create',
        glAccountId: 'gl_chk',
        glAccountName: 'Chase Checking (1234)',
        providerAccountId: 'p_35',
        name: 'Chase Checking (1234)',
        last4: '1234',
      },
    ])
  })

  it('proposes nothing for an account that already has a record, archived included', () => {
    const result = plan({
      chart: [gl('gl_a', 'Checking'), gl('gl_b', 'Savings')],
      providerAccountIds: new Map([
        ['gl_a', 'p_1'],
        ['gl_b', 'p_2'],
      ]),
      bankAccounts: [
        bank('ba_1', { glAccountId: 'gl_a' }),
        bank('ba_2', { glAccountId: 'gl_b', archivedAt: new Date() }),
      ],
    })
    expect(result.proposals).toEqual([])
  })

  it('links a feed account to the one account with its last4, instead of creating', () => {
    const result = plan({
      chart: [gl('gl_chk', 'Chase Checking (1234)'), gl('gl_sav', 'Savings (9999)')],
      providerAccountIds: new Map([
        ['gl_chk', 'p_1'],
        ['gl_sav', 'p_2'],
      ]),
      bankAccounts: [feed('ba_fc', '1234')],
    })
    expect(result.proposals.map((p) => p.key)).toEqual(['link:ba_fc:gl_chk', 'create:gl_sav'])
    expect(result.proposals[0]).toMatchObject({ kind: 'link', manualBankAccountId: null })
    expect(result.notes).toEqual([])
  })

  it("reads an account's last4 from its manual record and names that record", () => {
    const result = plan({
      chart: [gl('gl_chk', 'Operating')],
      bankAccounts: [
        bank('ba_manual', { glAccountId: 'gl_chk', last4: '4444' }),
        feed('ba_fc', '4444'),
      ],
    })
    expect(result.proposals).toEqual([
      expect.objectContaining({
        key: 'link:ba_fc:gl_chk',
        manualBankAccountId: 'ba_manual',
      }),
    ])
  })

  it('reports an ambiguous last4 on either side instead of guessing', () => {
    const twoAccounts = plan({
      chart: [gl('gl_a', 'Chase (1234)'), gl('gl_b', 'Wells x1234')],
      bankAccounts: [feed('ba_fc', '1234')],
    })
    expect(twoAccounts.proposals).toEqual([])
    expect(twoAccounts.notes).toEqual([
      expect.objectContaining({ kind: 'ambiguous_last4', glAccountIds: ['gl_a', 'gl_b'] }),
    ])

    const twoFeeds = plan({
      chart: [gl('gl_a', 'Chase (1234)')],
      bankAccounts: [feed('ba_1', '1234'), feed('ba_2', '1234')],
    })
    expect(twoFeeds.proposals).toEqual([])
    expect(twoFeeds.notes.map((n) => n.kind)).toEqual(['ambiguous_last4', 'ambiguous_last4'])
  })

  it('notes feeds with no last4, no match, or that are not depository', () => {
    const result = plan({
      chart: [gl('gl_a', 'Chase (1234)')],
      bankAccounts: [
        feed('ba_none', null),
        feed('ba_miss', '0000'),
        feed('ba_card', '1234', { type: 'credit' }),
      ],
    })
    expect(result.notes.map((n) => [n.bankAccountId, n.kind])).toEqual([
      ['ba_none', 'no_last4'],
      ['ba_miss', 'no_match'],
      ['ba_card', 'not_depository'],
    ])
  })

  it('does not link onto an account a connected feed already holds', () => {
    const result = plan({
      chart: [gl('gl_a', 'Chase (1234)')],
      bankAccounts: [feed('ba_old', '1234', { glAccountId: 'gl_a' }), feed('ba_new', '1234')],
    })
    expect(result.proposals).toEqual([])
    expect(result.notes).toEqual([expect.objectContaining({ kind: 'no_match' })])
  })

  it('is stable: the same input yields the same keys', () => {
    const input = {
      chart: [gl('gl_chk', 'Chase (1234)')],
      providerAccountIds: new Map([['gl_chk', 'p_1']]),
      bankAccounts: [feed('ba_fc', '1234')],
    }
    expect(plan(input).proposals.map((p) => p.key)).toEqual(plan(input).proposals.map((p) => p.key))
  })
})
