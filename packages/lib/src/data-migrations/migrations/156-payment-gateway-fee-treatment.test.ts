// packages/lib/src/data-migrations/migrations/156-payment-gateway-fee-treatment.test.ts
//
// Migration 156 adds two fields to an existing def and stamps a value onto
// every record that predates one of them. What actually goes wrong here:
//
//  - the registry and the migration disagree. The registry edit reaches only
//    NEW orgs and the migration reaches only EXISTING ones, so if the two say
//    different things a fresh org and a migrated org end up with different
//    fields - and nothing fails. Pinned below by asserting the registry
//    literals, not by restating them;
//  - 🛑 a SINGLE_SELECT seeded with no options renders BLANK. The field exists,
//    the write path accepts a value, and the picker offers nothing - so the
//    option list is asserted here rather than assumed from the fact that the
//    field was created;
//  - the stamped value is not one of the options. `FieldValue.optionId` holds
//    the option's `value` key, so a stamp that does not appear in the list is
//    an orphan that reads back as an unknown option forever;
//  - the id reuses a retired number. 001-150 were retired and `buildRegistry`
//    throws on reuse, but only at module load, so a test has to actually import
//    the registry to see it.

import { describe, expect, it } from 'vitest'
import {
  PAYMENT_GATEWAY_FEE_TREATMENTS,
  resolvePaymentGatewayFeeTreatment,
} from '../../payment-gateways/client'
import { PaymentGatewayFeeTreatment } from '../../resources/registry/enum-values'
import { PAYMENT_GATEWAY_FIELDS } from '../../resources/registry/resources/payment-gateway-fields'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../registry'
import { migration156PaymentGatewayFeeTreatment } from './156-payment-gateway-fee-treatment'

const MIGRATION_ID = '156-payment-gateway-fee-treatment'

/** What the migration stamps. A literal here on purpose - see the migration's doc. */
const STAMPED = 'netted'

describe('migration 156 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is the only migration claiming the number 156', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '156')).toHaveLength(1)
  })

  it('claims a number past the retired range', () => {
    // Was `Math.max(...) === 156` - true for exactly as long as 156 was the
    // newest migration. 157 is the one that made it a one-shot assertion.
    expect(Number(MIGRATION_ID.split('-')[0])).toBeGreaterThan(150)
    const numbers = ALL_DATA_MIGRATIONS.map((m) => Number(m.id.split('-')[0]))
    expect(numbers).toContain(156)
  })

  it('carries the id the module exports', () => {
    expect(migration156PaymentGatewayFeeTreatment.id).toBe(MIGRATION_ID)
  })

  it('describes both halves - the fields AND the stamp - for the ledger', () => {
    const { description } = migration156PaymentGatewayFeeTreatment
    expect(description).toMatch(/feeTreatment/)
    expect(description).toMatch(/lastFeeBookedAt/)
    expect(description).toMatch(/stamps netted/)
  })
})

describe('the registry says the same thing the migration provisions', () => {
  // 🔑 The whole point of this file. A new org is seeded from
  // PAYMENT_GATEWAY_FIELDS and an existing org is reached by the migration. If
  // these drift, a fresh org and a migrated org hold different fields and every
  // symptom shows up months later as "the fee treatment select is empty".

  it('declares feeTreatment as a SINGLE_SELECT on the attribute the migration matches', () => {
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.systemAttribute).toBe(
      'payment_gateway_fee_treatment'
    )
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.fieldType).toBe('SINGLE_SELECT')
  })

  it('carries the OPTIONS with the field, because a select with none renders blank', () => {
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.options?.options).toEqual(
      PaymentGatewayFeeTreatment.values
    )
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.options?.options?.map((o) => o.value)).toEqual([
      'netted',
      'billed',
    ])
  })

  it('defaults to netted, which is what the builder has always done', () => {
    // ⚠️ `netted` is the safe default precisely because it preserves today's
    // behaviour on every existing record: a payout entry WITH a fee leg.
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.defaultValue).toBe(STAMPED)
  })

  it('stamps a value that is actually one of the options', () => {
    // A stamped `optionId` outside the list is an orphan: it reads back as an
    // unknown option and the picker shows nothing selected.
    const values = PaymentGatewayFeeTreatment.values.map((o) => o.value)
    expect(values).toContain(STAMPED)
  })

  it('is not nullable - the record says what it is, the read does not guess', () => {
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.nullable).toBe(false)
  })

  it('declares lastFeeBookedAt as a nullable DATE, shaped like lastSettlementAt', () => {
    // Informational only, and nothing derives it in this lane. Its shape has to
    // match the field it sits beside, or the close console's two dates would
    // format differently for no reason.
    expect(PAYMENT_GATEWAY_FIELDS.lastFeeBookedAt?.systemAttribute).toBe(
      'payment_gateway_last_fee_booked_at'
    )
    expect(PAYMENT_GATEWAY_FIELDS.lastFeeBookedAt?.fieldType).toBe(
      PAYMENT_GATEWAY_FIELDS.lastSettlementAt?.fieldType
    )
    expect(PAYMENT_GATEWAY_FIELDS.lastFeeBookedAt?.type).toBe(
      PAYMENT_GATEWAY_FIELDS.lastSettlementAt?.type
    )
    expect(PAYMENT_GATEWAY_FIELDS.lastFeeBookedAt?.nullable).toBe(true)
  })

  it('keeps both fields writable, so the settings page can set them', () => {
    expect(PAYMENT_GATEWAY_FIELDS.feeTreatment?.capabilities?.updatable).toBe(true)
    expect(PAYMENT_GATEWAY_FIELDS.lastFeeBookedAt?.capabilities?.updatable).toBe(true)
  })
})

describe('the lib vocabulary mirrors the registry enum', () => {
  // Two declarations of one vocabulary: the registry's (what is stored on the
  // CustomField row) and `payment-gateways/client.ts`'s (what the writer
  // validates and the router's zod enum accepts). A value in one and not the
  // other is a write the field rejects, or an option the picker offers and the
  // writer refuses.
  it('lists the same values in the same order', () => {
    expect([...PAYMENT_GATEWAY_FEE_TREATMENTS]).toEqual(
      PaymentGatewayFeeTreatment.values.map((o) => o.value)
    )
  })

  it('coerces an unstamped record to netted, which is what an unmigrated org holds', () => {
    // ⚠️ This is what keeps an org that has NOT taken this migration yet
    // producing the entry it produced yesterday. The stamp does not make the
    // read-side coercion redundant.
    expect(resolvePaymentGatewayFeeTreatment(null)).toBe(STAMPED)
    expect(resolvePaymentGatewayFeeTreatment(undefined)).toBe(STAMPED)
    expect(resolvePaymentGatewayFeeTreatment('')).toBe(STAMPED)
    expect(resolvePaymentGatewayFeeTreatment('nonsense')).toBe(STAMPED)
    expect(resolvePaymentGatewayFeeTreatment('billed')).toBe('billed')
  })
})
