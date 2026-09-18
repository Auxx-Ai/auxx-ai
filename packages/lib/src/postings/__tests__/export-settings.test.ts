// packages/lib/src/postings/__tests__/export-settings.test.ts
//
// `avenueOfPostingType` is a switch with no `default`, so a `PostingType` added
// later fails to compile here - this file re-checks the same thing at runtime,
// over the ACTUAL `POSTING_TYPES` list, so a mismatch shows up in `vitest run`
// too, not only in a typecheck someone forgot to run.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ settings: new Map<string, unknown>() }))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings.get(key),
}))

import { avenueOfPostingType, EXPORT_AVENUES, SUMMARY_GRAIN_AVENUES } from '../export-settings'
import { readExportSettings } from '../read-export-settings'
import { POSTING_TYPES } from '../types'

describe('avenueOfPostingType', () => {
  it('is total over every POSTING_TYPES member - no throw, always an avenue or null', () => {
    for (const postingType of POSTING_TYPES) {
      const avenue = avenueOfPostingType(postingType)
      expect(avenue === null || EXPORT_AVENUES.includes(avenue)).toBe(true)
    }
  })

  it('maps the writers named in MIGRATION.md step 3', () => {
    expect(avenueOfPostingType('fulfillment')).toBe('fulfillment')
    expect(avenueOfPostingType('payment')).toBe('receipt')
    expect(avenueOfPostingType('refund')).toBe('refund')
    expect(avenueOfPostingType('credit_memo')).toBe('creditMemo')
    expect(avenueOfPostingType('invoice_issued')).toBe('invoice')
    expect(avenueOfPostingType('write_off')).toBe('invoice')
    expect(avenueOfPostingType('expense_bill')).toBe('expenseBill')
    expect(avenueOfPostingType('vendor_bill')).toBe('expenseBill')
    expect(avenueOfPostingType('payout')).toBe('payout')
    expect(avenueOfPostingType('bank_deposit')).toBe('bankDeposit')
    expect(avenueOfPostingType('manual_journal')).toBe('journal')
    expect(avenueOfPostingType('recurring_journal')).toBe('journal')
    expect(avenueOfPostingType('inventory_movement')).toBe('journal')
  })

  it('never exports an opening entry, a provider-authored entry, or a coded bank line', () => {
    expect(avenueOfPostingType('opening_balance')).toBeNull()
    expect(avenueOfPostingType('provider_sync')).toBeNull()
    expect(avenueOfPostingType('bank_transaction')).toBeNull()
  })
})

describe('readExportSettings', () => {
  it('fails closed to transaction mode, no cutover, autoSend off, day grain', async () => {
    h.settings.clear()

    const settings = await readExportSettings({} as never, 'org_1')

    expect(settings.mode).toBe('transaction')
    expect(settings.cutover).toBeNull()
    for (const avenue of EXPORT_AVENUES) expect(settings.autoSend[avenue]).toBe(false)
    for (const avenue of SUMMARY_GRAIN_AVENUES) expect(settings.summaryGrain[avenue]).toBe('day')
  })

  it('reads a configured summary mode, cutover, and per-avenue overrides', async () => {
    h.settings.clear()
    h.settings.set('accounting.exportMode', 'summary')
    h.settings.set('accounting.exportModeCutover', '2026-09-01')
    h.settings.set('accounting.autoSend.fulfillment', true)
    h.settings.set('accounting.summaryGrain.invoice', 'month')

    const settings = await readExportSettings({} as never, 'org_1')

    expect(settings.mode).toBe('summary')
    expect(settings.cutover).toBe('2026-09-01')
    expect(settings.autoSend.fulfillment).toBe(true)
    expect(settings.autoSend.payout).toBe(false)
    expect(settings.summaryGrain.invoice).toBe('month')
    expect(settings.summaryGrain.receipt).toBe('day')
  })
})
