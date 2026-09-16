// packages/lib/src/postings/__tests__/application-effect-types.test.ts
//
// The `money_application_v1` contract (D19, 53 §7.3.3, task B). It is the one
// D19 family that is money-owned, so the refusals worth asserting directly are
// the ones that keep the INVOICE an honest reference and the APPLICATION the
// identity.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import {
  acceptedMoneyApplicationEffectBasisSchema,
  MONEY_APPLICATION_EFFECT_KIND,
  MONEY_APPLICATION_POSTING_TYPE,
  moneyApplicationBasisSchema,
  moneyApplicationWorkBasisSchema,
} from '../application-effect-types'
import { moneyApplicationAccountingEffectKey } from '../application-effect-work'
import { POSTING_TYPES } from '../types'

const HASH = 'a'.repeat(64)

const line = (over: Record<string, unknown> = {}) => ({
  lineKey: 'line:0',
  accountRole: 'customer_deposits',
  glAccountId: null,
  direction: 'debit',
  amountMinor: '1000',
  counterpartyType: 'customer',
  counterpartyId: 'ct_1',
  dimensions: {},
  ...over,
})

const calculation = (over: Record<string, unknown> = {}) => ({
  version: 1,
  moneyApplicationId: 'ma_1',
  moneyTransactionId: 'mt_1',
  invoiceInstanceId: 'inv_1',
  invoiceNumber: 'INV-0001',
  contactInstanceId: 'ct_1',
  sourceHash: HASH,
  effectiveDate: '2026-09-01',
  currency: 'USD',
  currencyExponent: 2,
  amountMinor: '1000',
  lines: [
    line(),
    line({ lineKey: 'line:1', accountRole: 'accounts_receivable', direction: 'credit' }),
  ],
  ...over,
})

const contribution = (over: Record<string, unknown> = {}) => ({
  lineKey: 'line:0',
  glAccountId: 'gl_deposits',
  direction: 'debit',
  amountMinor: '1000',
  counterpartyType: 'customer',
  counterpartyId: 'ct_1',
  dimensions: {},
  ...over,
})

const resolution = (over: Record<string, unknown> = {}) => ({
  lineKey: 'line:0',
  glAccountId: 'gl_deposits',
  accountRole: 'customer_deposits',
  selectedBy: 'org_role',
  configurationHash: HASH,
  ...over,
})

const accepted = (over: Record<string, unknown> = {}) => ({
  version: 1,
  sourceBasisVersion: 1,
  sourceHash: HASH,
  policyKey: 'money_application_v1',
  policyVersion: 1,
  effectiveDate: '2026-09-01',
  bookTimeZone: 'America/New_York',
  currency: 'USD',
  currencyExponent: 2,
  documentRefs: [{ resourceKind: 'invoice', entityInstanceId: 'inv_1' }],
  calculation: calculation(),
  accountResolution: [
    resolution(),
    resolution({ lineKey: 'line:1', glAccountId: 'gl_ar', accountRole: 'accounts_receivable' }),
  ],
  contribution: [
    contribution(),
    contribution({ lineKey: 'line:1', glAccountId: 'gl_ar', direction: 'credit' }),
  ],
  ...over,
})

describe('the deposit_application family claims a real posting type', () => {
  it('names a `GlPostingType` the ledger knows', () => {
    expect(POSTING_TYPES).toContain(MONEY_APPLICATION_POSTING_TYPE)
  })

  it('is its own effect kind', () => {
    expect(MONEY_APPLICATION_EFFECT_KIND).toBe('deposit_application')
  })
})

describe('moneyApplicationAccountingEffectKey', () => {
  // 🔑 The whole point of task B: one receipt applied to three invoices is three
  // obligations, so keying on the movement would let the first swallow the rest.
  it('gives each application of one movement its own identity', () => {
    const keys = ['ma_1', 'ma_2', 'ma_3'].map(moneyApplicationAccountingEffectKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('deposit_application:["ma_1","original"]')
  })

  it('refuses a blank application id', () => {
    expect(() => moneyApplicationAccountingEffectKey('')).toThrow(UnprocessableEntityError)
  })
})

describe('moneyApplicationBasisSchema', () => {
  it('accepts a balanced reclass', () => {
    expect(moneyApplicationBasisSchema.safeParse(calculation()).success).toBe(true)
  })

  it('refuses lines that do not balance', () => {
    const broken = calculation()
    broken.lines[1]!.amountMinor = '900'
    expect(moneyApplicationBasisSchema.safeParse(broken).success).toBe(false)
  })

  it('refuses lines that do not add up to the applied amount', () => {
    expect(moneyApplicationBasisSchema.safeParse(calculation({ amountMinor: '999' })).success).toBe(
      false
    )
  })

  it('refuses a line naming both an account role and an account id', () => {
    const broken = calculation({
      lines: [
        line({ glAccountId: 'gl_deposits' }),
        line({ lineKey: 'line:1', direction: 'credit' }),
      ],
    })
    expect(moneyApplicationBasisSchema.safeParse(broken).success).toBe(false)
  })
})

describe('moneyApplicationWorkBasisSchema', () => {
  it('accepts ready evidence that agrees with its calculation', () => {
    const parsed = moneyApplicationWorkBasisSchema.safeParse({
      version: 1,
      status: 'ready',
      moneyApplicationId: 'ma_1',
      moneyTransactionId: 'mt_1',
      sourceHash: HASH,
      effectiveDate: '2026-09-01',
      calculation: calculation(),
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses ready evidence whose owner differs from its calculation', () => {
    const parsed = moneyApplicationWorkBasisSchema.safeParse({
      version: 1,
      status: 'ready',
      moneyApplicationId: 'ma_other',
      moneyTransactionId: 'mt_1',
      sourceHash: HASH,
      effectiveDate: '2026-09-01',
      calculation: calculation(),
    })
    expect(parsed.success).toBe(false)
  })

  it('allows durable incomplete evidence with named dependencies', () => {
    const parsed = moneyApplicationWorkBasisSchema.safeParse({
      version: 1,
      status: 'incomplete',
      moneyApplicationId: 'ma_1',
      moneyTransactionId: 'mt_1',
      sourceHash: HASH,
      effectiveDate: null,
      missingDependencies: ['invoice'],
      observed: { invoiceInstanceId: 'inv_1' },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('acceptedMoneyApplicationEffectBasisSchema', () => {
  it('accepts a contribution that is the frozen lines with accounts resolved', () => {
    expect(acceptedMoneyApplicationEffectBasisSchema.safeParse(accepted()).success).toBe(true)
  })

  // 🛑 The invoice is a REFERENCE, and a reference that names nothing is how an
  // accepted effect loses the document it relieved.
  it('refuses an effect whose documentRefs do not name its invoice', () => {
    const broken = accepted({
      documentRefs: [{ resourceKind: 'invoice', entityInstanceId: 'inv_other' }],
    })
    expect(acceptedMoneyApplicationEffectBasisSchema.safeParse(broken).success).toBe(false)
  })

  it('refuses a contribution that drifts from the application line it names', () => {
    const broken = accepted()
    broken.contribution[1]!.amountMinor = '900'
    expect(acceptedMoneyApplicationEffectBasisSchema.safeParse(broken).success).toBe(false)
  })

  it('refuses a contribution that left the account role its application named', () => {
    const broken = accepted()
    broken.accountResolution[1]!.accountRole = 'customer_deposits'
    expect(acceptedMoneyApplicationEffectBasisSchema.safeParse(broken).success).toBe(false)
  })

  it('refuses another policy key on this contract', () => {
    expect(
      acceptedMoneyApplicationEffectBasisSchema.safeParse(
        accepted({ policyKey: 'document_entry_v1' })
      ).success
    ).toBe(false)
  })
})
