// packages/lib/src/accounting/ledger/setup/__tests__/setup-readiness.test.ts
//
// The predicate is PURE, so the whole of it is reachable from here: the period,
// the one opening requirement (plans/accounting/tasks/103 §5a) and the helpers.

import { describe, expect, it } from 'vitest'
import { ACCOUNTING_GOAL_KEYS } from '../../../../getting-started/client'
import {
  OPENING_FROM_NOTHING_SETTING_KEY,
  openingTrialBalanceDifference,
  readOpeningFromNothing,
  resolveSetupReadiness,
  SETUP_READINESS_SETTING_KEYS,
  type SettingsRecord,
  summariseOpeningTrialBalance,
} from '../setup-readiness'

/** A settings record with every other requirement already met. */
function settings(overrides: SettingsRecord = {}): SettingsRecord {
  return {
    'accounting.setupState': 'draft',
    'accounting.cutoffPeriod': '2026-12',
    'accounting.bookTimeZone': 'America/New_York',
    ...overrides,
  }
}

function requirement(readiness: ReturnType<typeof resolveSetupReadiness>, key: string) {
  const found = readiness.requirements.find((r) => r.key === key)
  if (!found) throw new Error(`no requirement ${key}`)
  return found
}

describe('openingTrialBalanceDifference', () => {
  it('is Σ debits − Σ credits, in minor units', () => {
    expect(
      openingTrialBalanceDifference([
        { direction: 'debit', amountMinor: 500_00 },
        { direction: 'credit', amountMinor: 300_00 },
      ])
    ).toBe(200_00)
  })

  it('is zero on a balanced trial balance and on an empty one', () => {
    expect(
      openingTrialBalanceDifference([
        { direction: 'debit', amountMinor: 500_00 },
        { direction: 'credit', amountMinor: 500_00 },
      ])
    ).toBe(0)
    expect(openingTrialBalanceDifference([])).toBe(0)
  })

  it('adds an amount, never subtracts it - direction is the only carrier of sign', () => {
    // A negative amount is `buildManualEntry`'s refusal to make, naming the row.
    // Absorbing it here would let a grid with a typo read as balanced.
    expect(
      openingTrialBalanceDifference([
        { direction: 'debit', amountMinor: -100 },
        { direction: 'credit', amountMinor: -100 },
      ])
    ).toBe(0)
  })
})

describe('summariseOpeningTrialBalance', () => {
  it('counts only rows that carry an amount', () => {
    expect(
      summariseOpeningTrialBalance([
        { direction: 'debit', amountMinor: 500_00 },
        { direction: 'credit', amountMinor: 0 },
        { direction: 'credit', amountMinor: 500_00 },
      ])
    ).toEqual({ debitMinor: 500_00, creditMinor: 500_00, rows: 2, differenceMinor: 0 })
  })

  it('ignores a non-finite amount rather than propagating NaN through the verdict', () => {
    const summary = summariseOpeningTrialBalance([
      { direction: 'debit', amountMinor: Number.NaN },
      { direction: 'debit', amountMinor: 100 },
      { direction: 'credit', amountMinor: 100 },
    ])
    expect(summary).toEqual({ debitMinor: 100, creditMinor: 100, rows: 2, differenceMinor: 0 })
  })
})

describe('the requirement keys and the checklist goal keys', () => {
  it('🛑 every requirement this predicate emits is a goal in ACCOUNTING_GOAL_KEYS', () => {
    // A requirement with no goal key is one the wizard's gate can never ask about.
    const emitted = resolveSetupReadiness(settings()).requirements.map((r) => r.key)
    const goals = new Set<string>(ACCOUNTING_GOAL_KEYS)
    expect(emitted.filter((key) => !goals.has(key))).toEqual([])
  })
})

const BALANCED = { debitMinor: 500_00, creditMinor: 500_00, rows: 4 }
const EMPTY = { debitMinor: 0, creditMinor: 0, rows: 0 }

describe('resolveSetupReadiness: the opening requirement', () => {
  it('emits exactly the period and the opening, in order', () => {
    expect(resolveSetupReadiness(settings()).requirements.map((r) => r.key)).toEqual([
      'set-accounting-period',
      'set-opening-balances',
    ])
  })

  it('reads an absent opening as met, so a loading screen does not flash red', () => {
    const readiness = resolveSetupReadiness(settings())
    expect(requirement(readiness, 'set-opening-balances').met).toBe(true)
    expect(readiness.settingsReady).toBe(true)
  })

  it('is met by a posted opening entry, whatever the draft summary says', () => {
    const readiness = resolveSetupReadiness(settings(), {
      opening: { posted: true, summary: EMPTY },
    })
    expect(requirement(readiness, 'set-opening-balances').met).toBe(true)
  })

  it('is met by a balanced draft ready to post', () => {
    const readiness = resolveSetupReadiness(settings(), {
      opening: { posted: false, summary: BALANCED },
    })
    expect(requirement(readiness, 'set-opening-balances').met).toBe(true)
    expect(readiness.settingsReady).toBe(true)
  })

  it('is unmet on an empty draft, naming what to do', () => {
    const readiness = resolveSetupReadiness(settings(), {
      opening: { posted: false, summary: EMPTY },
    })
    const opening = requirement(readiness, 'set-opening-balances')
    expect(opening.met).toBe(false)
    expect(opening.reason).toMatch(/No opening balances yet/)
    expect(readiness.settingsReady).toBe(false)
  })

  it('is unmet on an unbalanced draft, naming the difference', () => {
    const readiness = resolveSetupReadiness(settings(), {
      opening: { posted: false, summary: { debitMinor: 500_00, creditMinor: 400_00, rows: 3 } },
    })
    const opening = requirement(readiness, 'set-opening-balances')
    expect(opening.met).toBe(false)
    expect(opening.reason).toMatch(/out of balance by 10000 cents/)
  })

  it('is met from nothing, even with no draft at all', () => {
    const readiness = resolveSetupReadiness(
      settings({ [OPENING_FROM_NOTHING_SETTING_KEY]: true }),
      {
        opening: { posted: false, summary: EMPTY },
      }
    )
    expect(requirement(readiness, 'set-opening-balances').met).toBe(true)
  })

  it('asks for nothing about inventory or a provider', () => {
    expect(
      SETUP_READINESS_SETTING_KEYS.some((key) => /qbo|openingRaw|openingWip|Finished/.test(key))
    ).toBe(false)
  })
})

describe('resolveSetupReadiness: the period requirement', () => {
  it('names a missing cutoff', () => {
    const readiness = resolveSetupReadiness(settings({ 'accounting.cutoffPeriod': null }))
    expect(requirement(readiness, 'set-accounting-period').reason).toMatch(/No cutoff period set/)
    expect(readiness.settingsReady).toBe(false)
  })

  it('reads finalized off accounting.setupState alone', () => {
    expect(resolveSetupReadiness(settings()).finalized).toBe(false)
    expect(
      resolveSetupReadiness(settings({ 'accounting.setupState': 'finalized' })).finalized
    ).toBe(true)
  })
})

describe('readOpeningFromNothing', () => {
  it('is true only for a literal true', () => {
    expect(readOpeningFromNothing({ [OPENING_FROM_NOTHING_SETTING_KEY]: true })).toBe(true)
    expect(readOpeningFromNothing({ [OPENING_FROM_NOTHING_SETTING_KEY]: 'true' })).toBe(false)
    expect(readOpeningFromNothing({})).toBe(false)
  })
})
