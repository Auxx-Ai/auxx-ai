// packages/lib/src/postings/__tests__/suggest-account-identities.test.ts
//
// The `G19` matcher is pure, so this file needs no doubles of any kind - both
// charts are arrays and every rule below is argued for in the module header.
//
// What is actually being defended here is the ambiguity rule. A suggestion that
// silently takes the first of two candidates produces a mapping a person will
// confirm without looking, and a wrong account id in a journal entry BALANCES -
// so there is no reader downstream that could ever catch it.

import { describe, expect, it } from 'vitest'
import {
  isMappableTo,
  suggestAccountIdentities,
  validateProviderMapping,
} from '../suggest-account-identities'
import type { ChartAccountRow, ProviderAccount } from '../types'

function ours(over: Partial<ChartAccountRow> = {}): ChartAccountRow {
  return {
    id: 'gl1',
    code: '1310',
    name: 'Raw Materials',
    accountType: 'asset',
    isActive: true,
    ...over,
  }
}

function theirs(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: '92',
    name: 'Inventory Asset',
    fullyQualifiedName: 'Inventory Asset',
    number: null,
    accountType: 'Other Current Asset',
    classification: 'asset',
    active: true,
    ...over,
  }
}

describe('matching by account number', () => {
  it('pairs two accounts carrying the same number', () => {
    const [suggestion] = suggestAccountIdentities([ours()], [theirs({ number: '1310' })])

    expect(suggestion?.glAccountId).toBe('gl1')
    expect(suggestion?.account.id).toBe('92')
    expect(suggestion?.reason).toBe('number')
  })

  it('ignores surrounding whitespace and case on both sides', () => {
    const [suggestion] = suggestAccountIdentities(
      [ours({ code: ' 1310 ' })],
      [theirs({ number: '1310' })]
    )
    expect(suggestion?.reason).toBe('number')
  })

  it('offers nothing when two provider accounts share the number', () => {
    // The whole point. Two candidates means the evidence does not distinguish
    // them, and answering anyway hides that behind something that looks decided.
    const suggestions = suggestAccountIdentities(
      [ours()],
      [theirs({ id: '1', number: '1310' }), theirs({ id: '2', number: '1310' })]
    )
    expect(suggestions).toHaveLength(0)
  })

  it('does not treat two blank numbers as a match', () => {
    // The ordinary QuickBooks case: numbering is off, so every `number` is null.
    // Reading that as "they agree" would map the entire chart at random.
    const suggestions = suggestAccountIdentities(
      [ours({ code: '' })],
      [theirs({ number: null }), theirs({ id: '93', number: null })]
    )
    expect(suggestions).toHaveLength(0)
  })
})

describe('matching by name', () => {
  it('pairs on an exact name when no number matches', () => {
    const [suggestion] = suggestAccountIdentities(
      [ours({ name: 'Inventory Asset' })],
      [theirs({ number: '9999' })]
    )
    expect(suggestion?.reason).toBe('name')
  })

  it('matches the fully-qualified name for a nested provider account', () => {
    const [suggestion] = suggestAccountIdentities(
      [ours({ accountType: 'revenue', name: 'Sales:Product Income' })],
      [
        theirs({
          classification: 'revenue',
          name: 'Product Income',
          fullyQualifiedName: 'Sales:Product Income',
        }),
      ]
    )
    expect(suggestion?.reason).toBe('name')
  })

  it('collapses punctuation and spacing rather than demanding an exact string', () => {
    const [suggestion] = suggestAccountIdentities(
      [ours({ accountType: 'expense', name: 'COGS - Product Cost' })],
      [theirs({ classification: 'expense', name: 'Cogs   Product Cost' })]
    )
    expect(suggestion?.reason).toBe('name')
  })

  it('offers nothing when two provider accounts share the name', () => {
    const suggestions = suggestAccountIdentities(
      [ours({ name: 'Inventory Asset' })],
      [theirs({ id: '1' }), theirs({ id: '2' })]
    )
    expect(suggestions).toHaveLength(0)
  })

  it('prefers the number match over the name match', () => {
    const [suggestion] = suggestAccountIdentities(
      [ours({ name: 'Inventory Asset' })],
      [theirs({ id: 'by-name' }), theirs({ id: 'by-number', name: 'Other', number: '1310' })]
    )
    expect(suggestion?.account.id).toBe('by-number')
    expect(suggestion?.reason).toBe('number')
  })
})

describe('what is never offered', () => {
  it('never crosses statement sections, however strong the other evidence', () => {
    // A liability and a revenue account both numbered 2160 is a filter case, not
    // a tiebreak: posting to the wrong section balances and misstates the P&L.
    const suggestions = suggestAccountIdentities(
      [ours({ accountType: 'liability', code: '2160' })],
      [theirs({ classification: 'revenue', number: '2160' })]
    )
    expect(suggestions).toHaveLength(0)
  })

  it('never offers an inactive provider account', () => {
    const suggestions = suggestAccountIdentities(
      [ours()],
      [theirs({ number: '1310', active: false })]
    )
    expect(suggestions).toHaveLength(0)
  })

  it('skips accounts somebody has already mapped', () => {
    // A suggestion must never appear to compete with a confirmation.
    const suggestions = suggestAccountIdentities(
      [ours()],
      [theirs({ number: '1310' })],
      new Set(['gl1'])
    )
    expect(suggestions).toHaveLength(0)
  })

  it('returns nothing at all when the provider chart is empty', () => {
    expect(suggestAccountIdentities([ours()], [])).toHaveLength(0)
  })
})

describe('validateProviderMapping - the check every close re-runs', () => {
  it('passes a live, active, type-compatible mapping', () => {
    expect(validateProviderMapping(ours(), theirs(), '92')).toBeNull()
  })

  it('names the account when the provider account has gone', () => {
    const message = validateProviderMapping(ours(), null, '92')
    expect(message).toContain('1310')
    expect(message).toContain('no longer exists')
  })

  it('distinguishes deactivated from missing', () => {
    // Different remedies: reactivate it there, versus re-map it here.
    const message = validateProviderMapping(ours(), theirs({ active: false }), '92')
    expect(message).toContain('deactivated')
  })

  it('catches a mapping that has drifted into another section', () => {
    const message = validateProviderMapping(ours(), theirs({ classification: 'revenue' }), '92')
    expect(message).toContain('revenue')
    expect(message).toContain('balance')
  })
})

describe('isMappableTo - what a picker may offer', () => {
  it('accepts an active account in the same section', () => {
    expect(isMappableTo(ours(), theirs())).toBe(true)
  })

  it('rejects an inactive one', () => {
    expect(isMappableTo(ours(), theirs({ active: false }))).toBe(false)
  })

  it('rejects one in another section', () => {
    expect(isMappableTo(ours(), theirs({ classification: 'expense' }))).toBe(false)
  })
})
