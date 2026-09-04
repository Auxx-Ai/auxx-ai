// packages/lib/src/banking/feed/__tests__/pins.test.ts
//
// Which raw columns a posted bank line freezes against its feed, and - the part
// that costs money - which one it deliberately does NOT.
//
// 🛑 The entity sink drops a pinned field SILENTLY (`entity-sink.ts`
// `buildWriteSet` just `continue`s past it). So every attribute in this list is
// an update from the bank that will never arrive and never be reported, and the
// list has to be exactly the fields an existing posting was built from.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  setConnectorFieldPin: vi.fn(),
  fields: {} as Record<string, { id: string } | null>,
}))

vi.mock('../../../data-connectors/mutations', () => ({
  setConnectorFieldPin: h.setConnectorFieldPin,
}))
vi.mock('../../reads', () => ({
  loadBankTransactionFieldContext: async () => ({ bankTransactionDefId: 'def_bt', fields: {} }),
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => h.fields }),
  }),
}))

const { pinPostedBankTransaction, unpinPostedBankTransaction } = await import('../pins')

const ALL_ATTRIBUTES = [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_bank_status',
  'bank_transaction_match_key',
  'bank_transaction_source',
]

const INPUT = { organizationId: 'org_1', bankTransactionId: 'txn_1', connectorId: 'conn_1' }

/** Which attributes were pinned, by the field id the fake cache handed out. */
function pinnedAttributes(): string[] {
  return h.setConnectorFieldPin.mock.calls
    .map(([, args]) => (args as { fieldId: string }).fieldId)
    .map((fieldId) => fieldId.replace(/^field:/, ''))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fields = Object.fromEntries(
    ALL_ATTRIBUTES.map((attribute) => [attribute, { id: `field:${attribute}` }])
  )
  h.setConnectorFieldPin.mockResolvedValue({ isOk: () => true })
})

describe('pinPostedBankTransaction', () => {
  it('freezes the columns the entry was BUILT from', async () => {
    // Rewriting any of these under a live posting leaves a `GlPosting` that no
    // longer matches its source document and still balances.
    await pinPostedBankTransaction({} as never, INPUT)
    expect(pinnedAttributes()).toEqual([
      'bank_transaction_external_id',
      'bank_transaction_bank_account',
      'bank_transaction_posted_at',
      'bank_transaction_description',
      'bank_transaction_amount',
    ])
  })

  it('🛑 does NOT freeze bankStatus, so a coded pending line that VOIDS becomes visible', async () => {
    // The case: a pending charge is coded and posted, then the bank withdraws
    // it. With the status pinned the sink drops the void silently, the row reads
    // `pending` forever, and a posting stands in the books for money that never
    // moved with no signal anywhere. Unpinned, the row flips to `void` - which
    // is what the queue shows and what `undoReview` (deliberately allowed on a
    // void line) exists to reverse.
    await pinPostedBankTransaction({} as never, INPUT)
    expect(pinnedAttributes()).not.toContain('bank_transaction_bank_status')
  })

  it('leaves the derived columns alone as well', async () => {
    await pinPostedBankTransaction({} as never, INPUT)
    expect(pinnedAttributes()).not.toContain('bank_transaction_match_key')
    expect(pinnedAttributes()).not.toContain('bank_transaction_source')
  })

  it('is a no-op count on a row the connector does not bind', async () => {
    h.setConnectorFieldPin.mockResolvedValue({ isOk: () => false })
    expect(await pinPostedBankTransaction({} as never, INPUT)).toBe(0)
  })

  it('skips an attribute the org has not got rather than throwing', async () => {
    h.fields = { bank_transaction_amount: { id: 'field:bank_transaction_amount' } }
    expect(await pinPostedBankTransaction({} as never, INPUT)).toBe(1)
  })
})

describe('unpinPostedBankTransaction', () => {
  it('releases exactly what it pinned, so the next sync can heal the row', async () => {
    await unpinPostedBankTransaction({} as never, INPUT)
    expect(h.setConnectorFieldPin).toHaveBeenCalledTimes(5)
    for (const [, args] of h.setConnectorFieldPin.mock.calls) {
      expect((args as { pinned: boolean }).pinned).toBe(false)
    }
  })
})
