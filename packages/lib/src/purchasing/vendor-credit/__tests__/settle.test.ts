// packages/lib/src/purchasing/vendor-credit/__tests__/settle.test.ts
//
// The credit's three amounts and the `issued <-> settled` flip are a PROJECTION
// of its applications and its refunds. Nothing else writes them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  credit: {} as Record<string, unknown>,
  applied: 0,
  refunded: 0,
  writes: [] as Array<Array<{ fieldId: string; value: unknown }>>,
}))

vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('../../../cache', () => ({
  getEntityDefIdResolver: async () => () => 'def_vendor_credit',
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = async (input: { values: Array<{ fieldId: string; value: unknown }> }) => {
      h.writes.push(input.values)
    }
  },
}))
vi.mock('../reads', () => ({
  requireVendorCredit: async () => h.credit,
  sumVendorCreditApplications: async () => h.applied,
  sumVendorCreditRefunds: async () => h.refunded,
}))

import type { Database } from '@auxx/database'
import { settleVendorCredit } from '../settle'

const db = {} as Database
const run = () =>
  settleVendorCredit(db, {
    organizationId: 'org_1',
    userId: 'user_1',
    vendorCreditInstanceId: 'vc_1',
  })
const last = () => h.writes.at(-1) ?? []

beforeEach(() => {
  h.writes = []
  h.applied = 0
  h.refunded = 0
  h.credit = {
    id: 'vc_1',
    number: 'VC-0001',
    status: 'issued',
    totalMinor: 100_000,
    amountAppliedMinor: 0,
    amountRefundedMinor: 0,
    balanceMinor: 100_000,
  }
})

describe('settleVendorCredit', () => {
  it('writes the three amounts and leaves an unsettled credit issued', async () => {
    h.applied = 40_000
    const state = await run()
    expect(state).toMatchObject({
      amountAppliedMinor: 40_000,
      amountRefundedMinor: 0,
      balanceMinor: 60_000,
      status: 'issued',
    })
    expect(last()).toContainEqual({ fieldId: 'vendor_credit_amount_applied', value: 40_000 })
    expect(last()).toContainEqual({ fieldId: 'vendor_credit_balance', value: 60_000 })
  })

  it('flips to settled when applications and refunds cover the total', async () => {
    h.applied = 60_000
    h.refunded = 40_000
    const state = await run()
    expect(state.balanceMinor).toBe(0)
    expect(state.status).toBe('settled')
    expect(last()).toContainEqual({ fieldId: 'vendor_credit_status', value: 'settled' })
  })

  it('flips back to issued when an application is taken away again', async () => {
    h.credit = { ...h.credit, status: 'settled', amountAppliedMinor: 100_000, balanceMinor: 0 }
    h.applied = 0
    const state = await run()
    expect(state.status).toBe('issued')
    expect(last()).toContainEqual({ fieldId: 'vendor_credit_status', value: 'issued' })
  })

  it('never moves a draft off draft — only the issue action does that', async () => {
    h.credit = { ...h.credit, status: 'draft' }
    const state = await run()
    expect(state.status).toBe('draft')
    for (const write of h.writes.flat()) expect(write.fieldId).not.toBe('vendor_credit_status')
  })

  it('leaves a void credit exactly as it found it', async () => {
    h.credit = { ...h.credit, status: 'void' }
    h.applied = 40_000
    await run()
    expect(h.writes).toEqual([])
  })
})
