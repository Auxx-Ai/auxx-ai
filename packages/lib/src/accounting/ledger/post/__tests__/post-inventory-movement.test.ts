// packages/lib/src/accounting/ledger/post/__tests__/post-inventory-movement.test.ts
//
// The seam every inventory writer goes through: ONE posting per document, with
// a member link to every movement it booked, and a reversal that frees the
// claim so the document can post again.
//
// `postEntryInTx` is stubbed. What is under test here is the SOURCE SET - the
// subject that is the claim, the parent a ledger card reads, and the members
// that are the subledger link - which is the half each of the seven writers
// would otherwise have its own opinion about.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  accountingEnabled: true,
  postEntryInTx: vi.fn(
    async (): Promise<Record<string, unknown>> => ({ status: 'posted', glPostingId: 'gp_1' })
  ),
  reverseEntry: vi.fn(async () => ({ status: 'posted' as const, glPostingId: 'gp_2' })),
  sourcePostings: [] as Array<Record<string, unknown>>,
  lineSourceIds: [] as string[],
}))

vi.mock('../../setup/accounting-enabled', () => ({
  isAccountingEnabled: async () => h.accountingEnabled,
}))
vi.mock('../../periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThrough: null }),
}))
vi.mock('../post-entry', () => ({
  postEntryInTx: h.postEntryInTx,
  exportPostedEntry: async () => ({ status: 'posted' as const }),
}))
vi.mock('../reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../reads/list-postings', () => ({
  listPostingsForSource: async () => ({
    isErr: () => false,
    value: h.sourcePostings,
  }),
}))
vi.mock('../../reads/read-posting', () => ({
  readPostingLineSourceIds: async () => ({ isErr: () => false, value: h.lineSourceIds }),
}))

import {
  postInventoryMovementInTx,
  reverseInventoryMovementPosting,
  reversePostingForMovement,
} from '../post-inventory-movement'

const TX = {} as never
const DB = {} as never

interface Source {
  sourceKind: string
  sourceId: string
  linkRole: string
  occurrence?: string
}

function lastSources(): Source[] {
  const call = h.postEntryInTx.mock.calls.at(-1) as unknown as [unknown, { sources: Source[] }]
  return call[1].sources
}

const SALE = {
  organizationId: 'org_1',
  kind: 'sale' as const,
  subject: { sourceKind: 'fulfillment', sourceId: 'ful_1', occurrence: 'inventory' },
  parent: { sourceKind: 'order', sourceId: 'ord_1' },
  txnDate: '2026-08-18',
  movements: [
    { id: 'sm_1', extendedCostMinor: -1_000, glAccountRole: 'inventory_finished_goods' },
    { id: 'sm_2', extendedCostMinor: -2_000, glAccountRole: 'inventory_finished_goods' },
  ],
}

describe('the source set one document posts with', () => {
  it('is one subject, one parent, and one member per movement', async () => {
    h.postEntryInTx.mockClear()
    await postInventoryMovementInTx(TX, SALE)

    expect(lastSources()).toEqual([
      {
        sourceKind: 'fulfillment',
        sourceId: 'ful_1',
        linkRole: 'subject',
        occurrence: 'inventory',
      },
      { sourceKind: 'order', sourceId: 'ord_1', linkRole: 'parent' },
      { sourceKind: 'stock_movement', sourceId: 'sm_1', linkRole: 'member' },
      { sourceKind: 'stock_movement', sourceId: 'sm_2', linkRole: 'member' },
    ])
  })

  it('claims a fulfillment under `inventory`, beside its own revenue entry', async () => {
    // 🛑 The claim is `(kind, id, occurrence)`. Without the occurrence the
    // inventory entry would contend with `fulfill.ts`'s revenue entry for one
    // row, and the loser converges to `already_posted` - a SUCCESS.
    h.postEntryInTx.mockClear()
    await postInventoryMovementInTx(TX, SALE)

    const subject = lastSources().find((source) => source.linkRole === 'subject')!
    expect(subject.occurrence).toBe('inventory')
  })

  it('omits the parent entirely when the document has none', async () => {
    h.postEntryInTx.mockClear()
    await postInventoryMovementInTx(TX, {
      ...SALE,
      kind: 'adjust',
      subject: { sourceKind: 'stock_movement', sourceId: 'sm_1' },
      parent: null,
      movements: [{ id: 'sm_1', extendedCostMinor: 500, glAccountRole: 'inventory_raw_materials' }],
    })

    expect(lastSources().some((source) => source.linkRole === 'parent')).toBe(false)
  })

  it('never drafts - the ledger must not sit behind the subledger by choice', async () => {
    h.postEntryInTx.mockClear()
    await postInventoryMovementInTx(TX, SALE)
    const call = h.postEntryInTx.mock.calls.at(-1) as unknown as [unknown, { mode: string }]
    expect(call[1].mode).toBe('post')
  })
})

describe('what it declines to post', () => {
  it('posts nothing at all when accounting is off for the org', async () => {
    h.accountingEnabled = false
    h.postEntryInTx.mockClear()

    expect(await postInventoryMovementInTx(TX, SALE)).toBeNull()
    expect(h.postEntryInTx).not.toHaveBeenCalled()
    h.accountingEnabled = true
  })

  it('posts nothing for a document that moved no money', async () => {
    h.postEntryInTx.mockClear()

    expect(
      await postInventoryMovementInTx(TX, {
        ...SALE,
        movements: [{ id: 'sm_1', extendedCostMinor: 0, glAccountRole: 'inventory_wip' }],
      })
    ).toBeNull()
    expect(h.postEntryInTx).not.toHaveBeenCalled()
  })
})

describe('the hashed claim key', () => {
  it('keys the entry on a hash of the subject, short enough to mint a document number', async () => {
    h.postEntryInTx.mockClear()
    await postInventoryMovementInTx(TX, {
      ...SALE,
      subject: { sourceKind: 'fulfillment', sourceId: 'vk7igmn5dmleap9c9ghqqki7' },
    })
    const call = h.postEntryInTx.mock.calls.at(-1) as unknown as [
      unknown,
      { entry: { periodKey: string } },
    ]
    expect(call[1].entry.periodKey).toBe('INV-2U62A5')
  })

  it('trusts `already_posted` when the winning posting holds THIS document', async () => {
    h.postEntryInTx.mockResolvedValue({ status: 'already_posted', glPostingId: 'gp_held' })
    h.lineSourceIds = ['ful_1']

    const result = await postInventoryMovementInTx(TX, {
      ...SALE,
      subject: { sourceKind: 'fulfillment', sourceId: 'ful_1' },
    })

    expect(result?.status).toBe('already_posted')
  })

  it('refuses `already_posted` when the key is held by a DIFFERENT document', async () => {
    // A 36^6 fold can collide, and `already_posted` is a SUCCESS - untreated,
    // this document's movements would sit in the subledger with no entry.
    h.postEntryInTx.mockResolvedValue({ status: 'already_posted', glPostingId: 'gp_other' })
    h.lineSourceIds = ['ful_999']

    const result = await postInventoryMovementInTx(TX, {
      ...SALE,
      subject: { sourceKind: 'fulfillment', sourceId: 'ful_1' },
    })

    expect(result?.status).toBe('error')
    expect(result?.error).toMatch(/collision/)
  })

  it('leaves an unreadable winner alone rather than refusing an ordinary re-post', async () => {
    h.postEntryInTx.mockResolvedValue({ status: 'already_posted', glPostingId: 'gp_held' })
    h.lineSourceIds = []

    const result = await postInventoryMovementInTx(TX, {
      ...SALE,
      subject: { sourceKind: 'fulfillment', sourceId: 'ful_1' },
    })

    expect(result?.status).toBe('already_posted')
    h.postEntryInTx.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })
  })
})

describe('freeing the claim', () => {
  it('reverses the live subject posting for the document', async () => {
    h.reverseEntry.mockClear()
    h.sourcePostings = [
      {
        id: 'gp_live',
        linkRole: 'subject',
        occurrence: 'inventory',
        postingType: 'inventory_movement',
        status: 'posted',
      },
    ]

    const result = await reverseInventoryMovementPosting(DB, {
      organizationId: 'org_1',
      subject: { sourceKind: 'fulfillment', sourceId: 'ful_1', occurrence: 'inventory' },
    })

    expect(result?.status).toBe('posted')
    const call = h.reverseEntry.mock.calls.at(-1) as unknown as [unknown, { glPostingId: string }]
    expect(call[1].glPostingId).toBe('gp_live')
  })

  it('is a no-op on a document whose entry is already reversed', async () => {
    h.reverseEntry.mockClear()
    h.sourcePostings = [
      {
        id: 'gp_old',
        linkRole: 'subject',
        occurrence: 'inventory',
        postingType: 'inventory_movement',
        status: 'reversed',
      },
    ]

    expect(
      await reverseInventoryMovementPosting(DB, {
        organizationId: 'org_1',
        subject: { sourceKind: 'fulfillment', sourceId: 'ful_1', occurrence: 'inventory' },
      })
    ).toBeNull()
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('ignores a posting claimed under a DIFFERENT occurrence', async () => {
    // The fulfillment's revenue entry is `original` on the same source. Reversing
    // it because a restock asked for the inventory one would back out the sale.
    h.reverseEntry.mockClear()
    h.sourcePostings = [
      {
        id: 'gp_revenue',
        linkRole: 'subject',
        occurrence: 'original',
        postingType: 'fulfillment',
        status: 'posted',
      },
    ]

    expect(
      await reverseInventoryMovementPosting(DB, {
        organizationId: 'org_1',
        subject: { sourceKind: 'fulfillment', sourceId: 'ful_1', occurrence: 'inventory' },
      })
    ).toBeNull()
  })

  it('finds the entry a single MOVEMENT was booked in, through its member link', async () => {
    h.reverseEntry.mockClear()
    h.sourcePostings = [
      {
        id: 'gp_doc',
        linkRole: 'member',
        occurrence: 'original',
        postingType: 'inventory_movement',
        status: 'posted',
      },
    ]

    const result = await reversePostingForMovement(DB, {
      organizationId: 'org_1',
      movementId: 'sm_1',
    })

    expect(result?.status).toBe('posted')
    const call = h.reverseEntry.mock.calls.at(-1) as unknown as [unknown, { glPostingId: string }]
    expect(call[1].glPostingId).toBe('gp_doc')
  })
})
