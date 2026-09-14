// packages/lib/src/returns/intake/__tests__/resolve.test.ts
//
// The tier ladder, with NO LLM anywhere in the file (plans/money/tasks/57 §4).
// The org cache is mocked and `db` is a chainable stub, so what is pinned is the
// POLICY: which tier fires, that the address tiers degrade SILENTLY on the
// database we actually have (`order_shipping_address` = 0 values, measured
// 2026-09-13), and that no candidate ever comes back carrying permission to
// link itself.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** One result array per `db.select()` call, in order. */
  results: [] as unknown[][],
  selectCalls: 0,
  /** What `readFulfillmentsForOrders` answers, keyed by order instance id. */
  fulfillments: new Map<string, { status: string; shippedAt: string }[]>(),
  fulfillmentCalls: 0,
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

vi.mock('../../../money/fulfillments/reads', () => ({
  readFulfillmentsForOrders: vi.fn(async (_db, params: { orderIds: readonly string[] }) => {
    h.fulfillmentCalls += 1
    const map = new Map<string, unknown[]>()
    for (const orderId of params.orderIds) {
      const rows = h.fulfillments.get(orderId)
      if (rows)
        map.set(
          orderId,
          rows.map((row) => ({ ...row, orderId }))
        )
    }
    return map
  }),
}))

import type { Database } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import type { TranscribedLabel } from '../client'
import { EMPTY_TRANSCRIBED_LABEL } from '../client'
import {
  looksLikeOutboundLabel,
  readOrderOptionsForContact,
  resolveLabelCandidates,
} from '../resolve'

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

function label(partial: Partial<TranscribedLabel> = {}): TranscribedLabel {
  return { ...EMPTY_TRANSCRIBED_LABEL, legible: true, ...partial }
}

/** One `contact` row as the name statement answers it. */
function contactRow(partial: Record<string, unknown> = {}) {
  return {
    contactId: 'contact_1',
    firstName: 'John',
    lastName: 'Smith',
    city: null,
    region: null,
    country: null,
    ...partial,
  }
}

/** One matched `order` row as the address statement answers it. */
function addressRow(partial: Record<string, unknown> = {}) {
  return {
    orderId: 'order_1',
    contactId: 'contact_1',
    orderNumber: '#1001',
    zipKey: '12 main st|94110',
    cityKey: '12 main st|san francisco|ca',
    ...partial,
  }
}

/** The `FieldValue` rows `readContactLabels` folds into a name and a place. */
const CONTACT_LABEL_ROWS = [
  { entityId: 'contact_1', fieldId: 'fld_first_name', valueText: 'John' },
  { entityId: 'contact_1', fieldId: 'fld_last_name', valueText: 'Smith' },
  { entityId: 'contact_1', fieldId: 'fld_city', valueText: 'San Francisco' },
]

beforeEach(() => {
  h.defs = new Map([
    ['contact', 'def_contact'],
    ['order', 'def_order'],
  ])
  h.materialised = new Set([
    'order_shipping_address',
    'order_contact',
    'order_number',
    'order_fulfillment_status',
    'first_name',
    'last_name',
    'city',
    'region',
    'country',
  ])
  h.results = []
  h.selectCalls = 0
  h.fulfillments = new Map()
  h.fulfillmentCalls = 0
})

describe('resolveLabelCandidates — the ladder', () => {
  it('🛑 an EMPTY order_shipping_address degrades to name_place, silently and without error', async () => {
    // The address statement runs and matches nothing — exactly what the dev
    // database answers today (0 values, all 28 orgs).
    h.results = [[], [contactRow({ city: 'San Francisco', region: 'CA' })]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({
        senderName: 'John Smith',
        senderStreet1: '12 Main St',
        senderPostalCode: '94110',
        senderCity: 'San Francisco',
        senderRegion: 'CA',
      }),
    ])

    expect(result.isOk()).toBe(true)
    const [candidates] = result._unsafeUnwrap()
    expect(candidates?.[0]?.tier).toBe('name_place')
    expect(candidates?.[0]?.orderRecordId).toBeNull()
  })

  it('tier 1: street + postal code names an ORDER and gets its contact for free', async () => {
    // No sender NAME on this label, so the name statement never runs and the
    // contact-label read is the second statement.
    h.results = [[addressRow()], CONTACT_LABEL_ROWS]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderStreet1: '12 Main St', senderPostalCode: '94110' }),
    ])

    const [candidates] = result._unsafeUnwrap()
    expect(candidates).toEqual([
      {
        contactRecordId: 'def_contact:contact_1',
        contactName: 'John Smith',
        contactPlace: 'San Francisco',
        orderRecordId: 'def_order:order_1',
        orderNumber: '#1001',
        tier: 'address',
      },
    ])
  })

  it('tier 2: a misread ZIP falls to street + city + region, still naming the order', async () => {
    h.results = [[addressRow({ zipKey: '12 main st|00000' })], CONTACT_LABEL_ROWS]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({
        senderStreet1: '12 Main St',
        senderPostalCode: '94110',
        senderCity: 'San Francisco',
        senderRegion: 'CA',
      }),
    ])

    const [candidates] = result._unsafeUnwrap()
    expect(candidates?.[0]?.tier).toBe('address_city')
    expect(candidates?.[0]?.orderRecordId).toBe('def_order:order_1')
  })

  it('tier 3: a name match the printed city agrees with is name_place', async () => {
    // No street on the label, so the address statement never runs at all and
    // the name statement is the first (and only) read.
    h.results = [[contactRow({ city: 'San Francisco', region: 'CA' })]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'John Smith', senderCity: 'San Francisco' }),
    ])

    expect(result._unsafeUnwrap()[0]?.[0]?.tier).toBe('name_place')
  })

  it('tier 4: a name match with nothing to narrow it by is tier `name`', async () => {
    h.results = [[contactRow()]]

    const result = await resolveLabelCandidates(db, 'org_1', [label({ senderName: 'John Smith' })])

    const [candidates] = result._unsafeUnwrap()
    expect(candidates?.[0]?.tier).toBe('name')
    expect(candidates?.[0]?.orderRecordId).toBeNull()
  })

  it('🛑 a contradicting country demotes an otherwise matching city to tier `name`', async () => {
    h.results = [[contactRow({ city: 'San Francisco', country: 'US' })]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'John Smith', senderCity: 'San Francisco', senderCountry: 'CA' }),
    ])

    expect(result._unsafeUnwrap()[0]?.[0]?.tier).toBe('name')
  })

  it('matches a name whatever order the label printed it in', async () => {
    h.results = [[contactRow()]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'SMITH, JOHN' }),
      label({ senderName: 'John Q Smith' }),
    ])

    const resolved = result._unsafeUnwrap()
    expect(resolved[0]?.[0]?.contactRecordId).toBe('def_contact:contact_1')
    expect(resolved[1]?.[0]?.contactRecordId).toBe('def_contact:contact_1')
  })

  it('a half-matching name (surname only in common) is not a candidate', async () => {
    h.results = [[contactRow({ firstName: 'Jane' })]]

    const result = await resolveLabelCandidates(db, 'org_1', [label({ senderName: 'John Smith' })])

    expect(result._unsafeUnwrap()[0]).toEqual([])
  })

  it('an address hit outranks a name hit for the same label', async () => {
    h.results = [[addressRow()], [contactRow()], CONTACT_LABEL_ROWS]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'John Smith', senderStreet1: '12 Main St', senderPostalCode: '94110' }),
    ])

    const [candidates] = result._unsafeUnwrap()
    // Same contact, and the row that also names an order wins outright — the
    // order-less duplicate is strictly less information.
    expect(candidates).toHaveLength(1)
    expect(candidates?.[0]?.tier).toBe('address')
  })

  it('two different orders for one contact both survive, because that IS the decision', async () => {
    h.results = [
      [addressRow(), addressRow({ orderId: 'order_2', orderNumber: '#1002' })],
      CONTACT_LABEL_ROWS,
    ]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderStreet1: '12 Main St', senderPostalCode: '94110' }),
    ])

    expect(result._unsafeUnwrap()[0]?.map((c) => c.orderRecordId)).toEqual([
      'def_order:order_1',
      'def_order:order_2',
    ])
  })

  it('🛑 nothing in a candidate says "link me" — the shape is a ranking and a badge', async () => {
    h.results = [[addressRow()], CONTACT_LABEL_ROWS]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderStreet1: '12 Main St', senderPostalCode: '94110' }),
    ])

    for (const candidate of result._unsafeUnwrap()[0] ?? []) {
      expect(Object.keys(candidate).sort()).toEqual(
        [
          'contactPlace',
          'contactName',
          'contactRecordId',
          'orderNumber',
          'orderRecordId',
          'tier',
        ].sort()
      )
      expect(candidate).not.toHaveProperty('autoLink')
      expect(candidate).not.toHaveProperty('confirmed')
    }
  })

  it('🛑 the module exports no auto-link authority for anything to ask', async () => {
    const module = await import('../resolve')
    expect(Object.keys(module)).not.toContain('isAutoLinkTier')
  })

  it('🛑 batches: twenty labels cost three statements, not eighty', async () => {
    const labels = Array.from({ length: 20 }, (_, i) =>
      label({
        senderName: `Person${i} Smith`,
        senderStreet1: `${i} Main St`,
        senderPostalCode: '94110',
      })
    )
    h.results = [[addressRow()], [contactRow()], CONTACT_LABEL_ROWS]

    const result = await resolveLabelCandidates(db, 'org_1', labels)

    expect(result._unsafeUnwrap()).toHaveLength(20)
    // address tiers + name tiers + the contact labels for the address hits.
    expect(h.selectCalls).toBe(3)
  })

  it('returns one entry per label, in input order, empty where nothing matched', async () => {
    h.results = [[contactRow()]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'Nobody Atall' }),
      label({ senderName: 'John Smith' }),
    ])

    const resolved = result._unsafeUnwrap()
    expect(resolved).toHaveLength(2)
    expect(resolved[0]).toEqual([])
    expect(resolved[1]).toHaveLength(1)
  })

  it('an illegible label with nothing transcribed costs no statement at all', async () => {
    const result = await resolveLabelCandidates(db, 'org_1', [label({ legible: false })])

    expect(result._unsafeUnwrap()).toEqual([[]])
    expect(h.selectCalls).toBe(0)
  })

  it('an org with no contact definition resolves to no candidates rather than failing', async () => {
    h.defs = new Map([['order', 'def_order']])
    h.results = [[addressRow()]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'John Smith', senderStreet1: '12 Main St', senderPostalCode: '94110' }),
    ])

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()[0]).toEqual([])
  })

  it('an org that never materialised order_shipping_address skips the address statement', async () => {
    h.materialised.delete('order_shipping_address')
    h.results = [[contactRow()]]

    const result = await resolveLabelCandidates(db, 'org_1', [
      label({ senderName: 'John Smith', senderStreet1: '12 Main St', senderPostalCode: '94110' }),
    ])

    expect(result._unsafeUnwrap()[0]?.[0]?.tier).toBe('name')
    expect(h.selectCalls).toBe(1)
  })

  it('an empty batch answers empty without touching the database', async () => {
    expect((await resolveLabelCandidates(db, 'org_1', []))._unsafeUnwrap()).toEqual([])
    expect(h.selectCalls).toBe(0)
  })
})

describe('readOrderOptionsForContact — §4.5', () => {
  const CONTACT = 'def_contact:contact_1' as RecordId

  it('⚠️ falls back to order_fulfillment_status while `fulfillment` holds 0 rows', async () => {
    h.results = [
      [
        { orderId: 'order_1', orderNumber: '#1001', fulfillmentStatus: 'fulfilled' },
        { orderId: 'order_2', orderNumber: '#1002', fulfillmentStatus: 'unfulfilled' },
      ],
    ]

    const result = await readOrderOptionsForContact(db, 'org_1', CONTACT)

    expect(result._unsafeUnwrap()).toEqual([
      { orderRecordId: 'def_order:order_1', orderNumber: '#1001', lastFulfilledAt: null },
    ])
  })

  it('a partially fulfilled order is still returnable against', async () => {
    h.results = [[{ orderId: 'order_1', orderNumber: '#1001', fulfillmentStatus: 'partial' }]]

    expect((await readOrderOptionsForContact(db, 'org_1', CONTACT))._unsafeUnwrap()).toHaveLength(1)
  })

  it('once fulfillments exist they decide, and the status fallback stops applying', async () => {
    h.results = [[{ orderId: 'order_1', orderNumber: '#1001', fulfillmentStatus: 'unfulfilled' }]]
    h.fulfillments.set('order_1', [{ status: 'success', shippedAt: '2026-09-01T00:00:00.000Z' }])

    const result = await readOrderOptionsForContact(db, 'org_1', CONTACT)

    expect(result._unsafeUnwrap()).toEqual([
      {
        orderRecordId: 'def_order:order_1',
        orderNumber: '#1001',
        lastFulfilledAt: '2026-09-01T00:00:00.000Z',
      },
    ])
  })

  it('🛑 a cancelled dispatch did not ship, and does not fall back to the status either', async () => {
    h.results = [[{ orderId: 'order_1', orderNumber: '#1001', fulfillmentStatus: 'fulfilled' }]]
    h.fulfillments.set('order_1', [{ status: 'cancelled', shippedAt: '2026-09-01T00:00:00.000Z' }])

    expect((await readOrderOptionsForContact(db, 'org_1', CONTACT))._unsafeUnwrap()).toEqual([])
  })

  it('the most recently shipped order comes first', async () => {
    h.results = [
      [
        { orderId: 'order_1', orderNumber: '#1001', fulfillmentStatus: 'fulfilled' },
        { orderId: 'order_2', orderNumber: '#1002', fulfillmentStatus: 'fulfilled' },
      ],
    ]
    h.fulfillments.set('order_1', [{ status: 'success', shippedAt: '2026-08-01T00:00:00.000Z' }])
    h.fulfillments.set('order_2', [
      { status: 'success', shippedAt: '2026-09-01T00:00:00.000Z' },
      { status: 'success', shippedAt: '2026-07-01T00:00:00.000Z' },
    ])

    const options = (await readOrderOptionsForContact(db, 'org_1', CONTACT))._unsafeUnwrap()
    expect(options.map((o) => o.orderNumber)).toEqual(['#1002', '#1001'])
    expect(options[0]?.lastFulfilledAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('a contact with no orders never asks the fulfillment reader anything', async () => {
    h.results = [[]]

    expect((await readOrderOptionsForContact(db, 'org_1', CONTACT))._unsafeUnwrap()).toEqual([])
    expect(h.fulfillmentCalls).toBe(0)
  })
})

describe('looksLikeOutboundLabel — §4.7', () => {
  it('does not flag a label where BOTH blocks name us — that is not the mistake', () => {
    expect(
      looksLikeOutboundLabel(
        label({ senderName: 'Auxx Lift GmbH', recipientNameRaw: 'Auxx Lift GmbH' }),
        'Auxx Lift'
      )
    ).toBe(false)
  })

  it('flags the outbound case: we are the RECIPIENT block and the sender is a customer', () => {
    expect(
      looksLikeOutboundLabel(
        label({ senderName: 'John Smith', recipientNameRaw: 'AUXX LIFT GMBH' }),
        'Auxx Lift'
      )
    ).toBe(true)
  })

  it('a genuine inbound return — customer sends, we receive — is NOT flagged', () => {
    expect(
      looksLikeOutboundLabel(
        label({ senderName: 'John Smith', recipientNameRaw: 'Some Warehouse' }),
        'Auxx Lift'
      )
    ).toBe(false)
  })

  it('says nothing when the org has no business name to compare against', () => {
    expect(looksLikeOutboundLabel(label({ recipientNameRaw: 'Auxx Lift' }), null)).toBe(false)
  })

  it('says nothing when the recipient block was not transcribed', () => {
    expect(looksLikeOutboundLabel(label({ senderName: 'John Smith' }), 'Auxx Lift')).toBe(false)
  })
})
