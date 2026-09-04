// packages/lib/src/postings/__tests__/setup-readiness.test.ts
//
// The predicate is PURE, so the whole of it is reachable from here. These tests
// cover the FOURTH requirement added by HANDOFF slot 1C and the two pure
// helpers behind it, plus the one property the extension had to preserve: the
// two existing callers pass no context, and neither may start reporting a
// requirement they never looked up.

import { describe, expect, it } from 'vitest'
import {
  openingTrialBalanceDifference,
  resolveSetupReadiness,
  type SettingsRecord,
  summariseOpeningTrialBalance,
} from '../setup-readiness'

/** A settings record with every other requirement already met. */
function settings(overrides: SettingsRecord = {}): SettingsRecord {
  return {
    'accounting.setupState': 'draft',
    'accounting.cutoffPeriod': '2026-12',
    'accounting.bookTimeZone': 'America/New_York',
    'accounting.openingRawMaterials': 100_00,
    'accounting.openingWip': 0,
    'accounting.openingFinishedGoods': 250_00,
    'accounting.qboOpeningRawMaterials': 100_00,
    'accounting.qboOpeningWip': 0,
    'accounting.qboOpeningFinishedGoods': 250_00,
    'accounting.qboOpeningJournalRef': 'JE-1042',
    'manufacturing.assemblyLaborCostPerUnit': 500,
    'manufacturing.overheadCostPerUnit': 300,
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

describe('resolveSetupReadiness: the opening trial balance requirement', () => {
  it('reports it MET when no context is given, and says nothing about it', () => {
    // 🛑 The `getting-started/signals.ts` contract. That caller runs server-side
    // over cached settings and has no journal-entry read in hand; reporting the
    // requirement unmet there would light an onboarding row red on a fact it
    // never looked up, and the checklist would then disagree with the wizard.
    const readiness = resolveSetupReadiness(settings())
    const row = requirement(readiness, 'set-opening-trial-balance')
    expect(row.met).toBe(true)
    expect(row.reason).toBeUndefined()
    expect(readiness.settingsReady).toBe(true)
  })

  it('reports it met when the caller passes a balanced trial balance', () => {
    const readiness = resolveSetupReadiness(settings(), {
      openingTrialBalance: { debitMinor: 500_00, creditMinor: 500_00, rows: 4 },
    })
    expect(requirement(readiness, 'set-opening-trial-balance').met).toBe(true)
    expect(readiness.settingsReady).toBe(true)
  })

  it('reports "nothing entered" separately from "does not balance"', () => {
    const readiness = resolveSetupReadiness(settings(), {
      openingTrialBalance: { debitMinor: 0, creditMinor: 0, rows: 0 },
    })
    const row = requirement(readiness, 'set-opening-trial-balance')
    expect(row.met).toBe(false)
    expect(row.reason).toMatch(/No opening trial balance entered/)
  })

  it('names the difference in cents when it does not balance', () => {
    const readiness = resolveSetupReadiness(settings(), {
      openingTrialBalance: { debitMinor: 500_00, creditMinor: 400_00, rows: 4 },
    })
    const row = requirement(readiness, 'set-opening-trial-balance')
    expect(row.met).toBe(false)
    expect(row.reason).toMatch(/out of balance by 10000/)
    // The trap the brief opens with: a plug account is the single worst thing
    // that can happen here, so the message says so rather than only reporting a
    // number.
    expect(row.reason).toMatch(/plug account/)
    expect(readiness.settingsReady).toBe(false)
  })

  it('reports an imbalance in either direction', () => {
    const readiness = resolveSetupReadiness(settings(), {
      openingTrialBalance: { debitMinor: 400_00, creditMinor: 500_00, rows: 4 },
    })
    expect(requirement(readiness, 'set-opening-trial-balance').reason).toMatch(
      /out of balance by 10000/
    )
  })
})

describe('resolveSetupReadiness: the three requirements that already existed', () => {
  it('still reports every original key, in order, with the new row before costing', () => {
    expect(resolveSetupReadiness(settings()).requirements.map((r) => r.key)).toEqual([
      'set-accounting-period',
      'set-opening-balances',
      'set-opening-trial-balance',
      'set-costing',
    ])
  })

  it('is unchanged on a half-configured org when no context is passed', () => {
    const readiness = resolveSetupReadiness(
      settings({ 'accounting.cutoffPeriod': null, 'manufacturing.overheadCostPerUnit': null })
    )
    expect(requirement(readiness, 'set-accounting-period').reason).toMatch(/No cutoff period set/)
    expect(requirement(readiness, 'set-costing').reason).toMatch(/No overhead rate/)
    expect(requirement(readiness, 'set-opening-trial-balance').met).toBe(true)
    expect(readiness.settingsReady).toBe(false)
  })

  it('still reads finalized off accounting.setupState alone', () => {
    expect(resolveSetupReadiness(settings()).finalized).toBe(false)
    expect(
      resolveSetupReadiness(settings({ 'accounting.setupState': 'finalized' })).finalized
    ).toBe(true)
  })

  it('blocks on the trial balance even when every setting is met', () => {
    const readiness = resolveSetupReadiness(settings({ 'accounting.setupState': 'draft' }), {
      openingTrialBalance: { debitMinor: 1, creditMinor: 0, rows: 1 },
    })
    expect(readiness.settingsReady).toBe(false)
  })
})
