// packages/lib/src/purchasing/intake/__tests__/resolve.test.ts
//
// The tier ladder, with NO LLM anywhere in the file (plans/money/tasks/38 §10).
// The org cache is mocked and `db` is a chainable stub, so what is pinned is the
// POLICY: which tier fires, which tiers may auto-link, that `fuzzy` never does,
// and that forty lines still cost one statement per tier rather than 120.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** One result array per `db.select()` call, in order. */
  results: [] as unknown[][],
  selectCalls: 0,
  /** `(part, supplier)` reads the ladder made, and what they answered. */
  vendorPartCalls: [] as { partInstanceId: string; vendorInstanceId: string }[],
  vendorPartRecordId: null as string | null,
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

vi.mock('../../vendor-part-lookup', async () => {
  const { ok } = await import('neverthrow')
  return {
    findVendorPartForLine: vi.fn(async (_db, _org, params) => {
      h.vendorPartCalls.push(params)
      return ok(
        h.vendorPartRecordId ? { vendorPartRecordId: h.vendorPartRecordId, unitPrice: null } : null
      )
    }),
  }
})

import type { Database } from '@auxx/database'
import type { TranscribedLine } from '../client'
import { resolveQuoteLines, resolveQuoteVendor } from '../resolve'

/** Answers `rows` however the builder is chained, then resolves on await. */
function chainReturning(rows: unknown[]): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(rows)
        return () => proxy
      },
    }
  )
  return proxy
}

const db = {
  select: () => chainReturning(h.results[h.selectCalls++] ?? []),
} as unknown as Database

const VENDOR = 'def_company:company_1' as never

function line(partial: Partial<TranscribedLine> = {}): TranscribedLine {
  return {
    lineNumber: 1,
    vendorCode: null,
    description: null,
    quantity: 10,
    unit: 'pcs',
    unitPriceText: null,
    lineTotalText: null,
    leadTime: null,
    priceBreaks: [],
    ...partial,
  }
}

const LABELS = [
  { entityId: 'part_1', fieldId: 'fld_part_title', valueText: 'Hex bolt M8x40 zinc' },
  { entityId: 'part_1', fieldId: 'fld_part_sku', valueText: 'HB-M8X40' },
]

beforeEach(() => {
  h.defs = new Map([
    ['part', 'def_part'],
    ['vendor_part', 'def_vendor_part'],
    ['company', 'def_company'],
  ])
  h.materialised = new Set([
    'part_sku',
    'part_title',
    'vendor_part_part',
    'vendor_part_contact',
    'vendor_part_vendor_sku',
    'company_name',
    'company_domain',
  ])
  h.results = []
  h.selectCalls = 0
  h.vendorPartCalls = []
  h.vendorPartRecordId = 'def_vendor_part:vp_1'
})

describe('resolveQuoteLines — the ladder', () => {
  it("tier 1: the vendor's own code on the vendor's own catalogue row auto-links", async () => {
    h.results = [
      [{ vendorPartInstanceId: 'vp_1', partInstanceId: 'part_1', code: 'af-4420' }],
      [],
      [],
      LABELS,
    ]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: VENDOR,
      currency: 'EUR',
      lines: [line({ vendorCode: 'AF-4420', description: 'Hex bolt' })],
    })

    const [resolved] = result._unsafeUnwrap()
    expect(resolved?.tier).toBe('vendor_sku')
    expect(resolved?.partRecordId).toBe('def_part:part_1')
    expect(resolved?.vendorPartRecordId).toBe('def_vendor_part:vp_1')
    expect(resolved?.candidates).toEqual([
      {
        recordId: 'def_part:part_1',
        displayName: 'Hex bolt M8x40 zinc',
        secondary: 'HB-M8X40',
        tier: 'vendor_sku',
      },
    ])
  })

  it('tier 2: our own SKU matches the printed code and auto-links', async () => {
    h.results = [[], [{ partInstanceId: 'part_1', key: 'hb-m8x40' }], [], LABELS]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: VENDOR,
      currency: 'EUR',
      lines: [line({ vendorCode: 'HB-M8X40' })],
    })

    const [resolved] = result._unsafeUnwrap()
    expect(resolved?.tier).toBe('sku')
    expect(resolved?.partRecordId).toBe('def_part:part_1')
    // Stamped through the existing reader, not a second hand-rolled query.
    expect(h.vendorPartCalls).toEqual([{ partInstanceId: 'part_1', vendorInstanceId: 'company_1' }])
    expect(resolved?.vendorPartRecordId).toBe('def_vendor_part:vp_1')
  })

  it('🛑 tier 3 offers candidates and NEVER auto-links', async () => {
    h.results = [[], [], [{ partInstanceId: 'part_1', key: 'hex bolt m8x40 zinc' }], LABELS]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: VENDOR,
      currency: 'EUR',
      lines: [line({ vendorCode: 'X-9', description: 'Hex bolt M8x40 zinc' })],
    })

    const [resolved] = result._unsafeUnwrap()
    expect(resolved?.tier).toBe('fuzzy')
    expect(resolved?.candidates).toHaveLength(1)
    expect(resolved?.partRecordId).toBeNull()
    // A tier the ladder will not link must not cost a catalogue read either.
    expect(h.vendorPartCalls).toEqual([])
  })

  it('tier 4: nothing matched, nothing offered, nothing linked', async () => {
    h.results = [[], [], []]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: VENDOR,
      currency: 'EUR',
      lines: [line({ vendorCode: 'FREIGHT', description: 'Carriage' })],
    })

    const [resolved] = result._unsafeUnwrap()
    expect(resolved?.tier).toBe('none')
    expect(resolved?.candidates).toEqual([])
    expect(resolved?.partRecordId).toBeNull()
  })

  it('tier 1 outranks tier 2 for the same printed code', async () => {
    h.results = [
      [{ vendorPartInstanceId: 'vp_1', partInstanceId: 'part_1', code: 'af-4420' }],
      [{ partInstanceId: 'part_2', key: 'af-4420' }],
      [],
      LABELS,
    ]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: VENDOR,
      currency: 'EUR',
      lines: [line({ vendorCode: 'AF-4420' })],
    })

    const [resolved] = result._unsafeUnwrap()
    expect(resolved?.tier).toBe('vendor_sku')
    expect(resolved?.partRecordId).toBe('def_part:part_1')
  })

  it('with no vendor picked, tier 1 is skipped entirely', async () => {
    h.results = [[{ partInstanceId: 'part_1', key: 'hb-m8x40' }], [], LABELS]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: null,
      currency: 'EUR',
      lines: [line({ vendorCode: 'HB-M8X40' })],
    })

    const [resolved] = result._unsafeUnwrap()
    expect(resolved?.tier).toBe('sku')
    // No supplier means no `(part, supplier)` pair to stamp provenance from.
    expect(resolved?.vendorPartRecordId).toBeNull()
    expect(h.vendorPartCalls).toEqual([])
  })

  it('🛑 batches: forty lines cost one statement per tier, not one per line', async () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      line({ lineNumber: i + 1, vendorCode: `HB-${i}`, description: `Part ${i}` })
    )
    h.results = [[], [{ partInstanceId: 'part_1', key: 'hb-7' }], [], LABELS]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: VENDOR,
      currency: 'EUR',
      lines,
    })

    expect(result._unsafeUnwrap()).toHaveLength(40)
    // vendor_sku + part_sku + part_title + labels.
    expect(h.selectCalls).toBe(4)
    // One catalogue read for the one part that linked, memoized by part.
    expect(h.vendorPartCalls).toHaveLength(1)
  })

  it("parses the vendor's printed price string exactly once, into minor units", async () => {
    h.results = [[], [], []]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: null,
      currency: 'EUR',
      lines: [line({ unitPriceText: '1.234,56'.replace('.', '').replace(',', '.') })],
    })

    expect(result._unsafeUnwrap()[0]?.unitPriceCents).toBe(123456)
  })

  it('an unread quantity stays zero rather than becoming a plausible 1', async () => {
    h.results = [[], [], []]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: null,
      currency: 'EUR',
      lines: [line({ quantity: null })],
    })

    expect(result._unsafeUnwrap()[0]?.quantity).toBe(0)
  })

  it('gives every line its own stable id', async () => {
    h.results = [[], [], []]

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: null,
      currency: 'EUR',
      lines: [line({ lineNumber: 1 }), line({ lineNumber: 2 })],
    })

    const [a, b] = result._unsafeUnwrap()
    expect(a?.lineId).toBeTruthy()
    expect(a?.lineId).not.toBe(b?.lineId)
  })

  it('an org with no part definition resolves everything to tier 4 rather than failing', async () => {
    h.defs = new Map()
    h.results = []

    const result = await resolveQuoteLines(db, 'org_1', {
      vendorRecordId: null,
      currency: 'EUR',
      lines: [line({ vendorCode: 'HB-M8X40' })],
    })

    expect(result._unsafeUnwrap()[0]?.tier).toBe('none')
    expect(h.selectCalls).toBe(0)
  })
})

describe('resolveQuoteVendor', () => {
  it('offers name matches and does not pick one', async () => {
    h.results = [
      [
        { id: 'company_1', name: 'Acme Fasteners GmbH' },
        { id: 'company_2', name: 'Acme Fasteners UK' },
      ],
    ]

    const result = await resolveQuoteVendor(db, 'org_1', {
      vendorName: 'Acme Fasteners',
      vendorEmail: 'sales@acme.example',
      vendorPhone: null,
      vendorAddress: null,
      quoteNumber: null,
      quoteDate: null,
      validUntil: null,
      currency: 'EUR',
      subtotalText: null,
      shippingText: null,
      taxText: null,
      totalText: null,
      lines: [],
    })

    expect(result._unsafeUnwrap().map((c) => c.recordId)).toEqual([
      'def_company:company_1',
      'def_company:company_2',
    ])
    expect(h.selectCalls).toBe(1)
  })

  it('falls back to the email domain only when the name found nothing', async () => {
    h.results = [[], [{ id: 'company_9', name: 'Fastener Direct' }]]

    const result = await resolveQuoteVendor(db, 'org_1', {
      vendorName: 'Nobody Ltd',
      vendorEmail: 'sales@fastenerdirect.example',
      vendorPhone: null,
      vendorAddress: null,
      quoteNumber: null,
      quoteDate: null,
      validUntil: null,
      currency: null,
      subtotalText: null,
      shippingText: null,
      taxText: null,
      totalText: null,
      lines: [],
    })

    expect(result._unsafeUnwrap()).toHaveLength(1)
    expect(h.selectCalls).toBe(2)
  })
})
