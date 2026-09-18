// packages/lib/src/accounting/reports/__tests__/completeness.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { readCompleteness } from '../completeness'

const ORG = 'org_1'

function stubDb(): Database {
  return {} as unknown as Database
}

describe('readCompleteness', () => {
  it('names every posting type not in ENABLED_POSTING_TYPES, each with a remedy', async () => {
    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    // Wave 2 flipped `fulfillment` on (revenue legs only, COGS leg dark); the
    // L3 buy side (`receipt`, `vendor_bill`) and `bank_transaction` are still
    // off and must be named, each with a remedy.
    expect(completeness.disabledPostingTypes.length).toBeGreaterThan(0)
    expect(completeness.disabledPostingTypes.every((item) => !!item.remedy?.href)).toBe(true)
    const ids = completeness.disabledPostingTypes.map((item) => item.id)
    expect(ids.some((id) => id.includes('month_end_reversal'))).toBe(true)
    expect(ids.some((id) => id.includes('fulfillment'))).toBe(false)
  })

  // 🛑 `provider_sync` is absent from `ENABLED_POSTING_TYPES` because a CLOSE
  // does not emit it - the inbound sync does (brief 20 §6). Reading that absence
  // as "switched off" would put a permanent, unfixable item on every org's
  // statements naming something nobody can turn on.
  it('does not report the synced posting type as switched off', async () => {
    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    expect(completeness.disabledPostingTypes.map((item) => item.id)).not.toContain(
      'disabled-posting-type:provider_sync'
    )
    expect(completeness.items.some((item) => item.label.includes('provider_sync'))).toBe(false)
  })

  // 🛑 The export backlog is NOT a completeness item. Every entry in it is in
  // the books and in these figures - no statement read filters on
  // `exportStatus` - so naming it under "Not included in this report" was false
  // about every row, and the rows are the outbox's subject. See the file
  // header.
  it('says nothing about entries that have not reached the accounting provider', async () => {
    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    expect(completeness.items.every((item) => item.id.startsWith('disabled-posting-type:'))).toBe(
      true
    )
    expect(completeness.items.some((item) => item.label.includes('accounting system'))).toBe(false)
  })

  // 🛑 Every item used to point at `/app/accounting`, and a posting type cannot
  // be switched on from the ledger - or from anywhere in the product; `enabled`
  // is a deploy. The Posting settings page is the one screen that explains the
  // item, and every type in today's list is `never`-triggered, so it lives in
  // that page's collapsed "Not posting" section rather than at its own anchor.
  it('sends a disabled posting type to the settings page that explains it', async () => {
    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    expect(completeness.items.length).toBeGreaterThan(0)
    for (const item of completeness.items) {
      expect(item.remedy?.href).toBe('/app/accounting/settings/posting#posting-never')
      expect(item.remedy?.label).toBe('Posting settings')
    }
  })

  it('leaves the bank-feed placeholders empty until the feed exists', async () => {
    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    expect(completeness.unreviewedBankLines).toEqual([])
    expect(completeness.coverageGaps).toEqual([])
  })
})
