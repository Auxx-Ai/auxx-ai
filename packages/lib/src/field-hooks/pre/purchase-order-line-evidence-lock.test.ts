// packages/lib/src/field-hooks/pre/purchase-order-line-evidence-lock.test.ts
//
// §6.5 of plans/purchasing/07-purchase-order-send-and-status.md rejects the obvious rule
// ("lock when issued") in both directions, so the thing worth pinning is that the predicate
// is EVIDENCE and status never enters it: a draft line with a receipt locks, and an issued
// line with nothing booked against it does not.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldPreHookEvent } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  /** Result sets, in call order: evidence probe, then the stored-value read. */
  dbResults: [] as unknown[][],
}))

function makeChain() {
  const result = h.dbResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit']) {
    chain[key] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

vi.mock('@auxx/database', () => ({
  database: { select: () => makeChain(), selectDistinct: () => makeChain() },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      relatedEntityId: 'relatedEntityId',
    },
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

const { guardEvidenceLockedLineFields } = await import('./purchase-order-line-evidence-lock')
const { ConflictError } = await import('../../errors')

const MOVEMENT_REL = 'f-movement-rel'
const BILL_LINE_REL = 'f-bill-line-rel'
const QTY_FIELD = 'f-qty'

/** Which evidence rows the probe finds. */
function wireEvidence(kinds: Array<'receipt' | 'bill'>) {
  h.bySystemAttributes.mockResolvedValue({
    stock_movement_purchase_order_line: { id: MOVEMENT_REL },
    vendor_bill_line_purchase_order_line: { id: BILL_LINE_REL },
  })
  h.dbResults = [
    kinds.map((kind) => ({ fieldId: kind === 'receipt' ? MOVEMENT_REL : BILL_LINE_REL })),
  ]
}

/** The value currently stored on the line for the field under edit. */
function wireStored(valueNumber: number | null) {
  h.dbResults.push(valueNumber === null ? [] : [{ valueNumber }])
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'def-purchase_order_line:poline-1',
    entityDefinitionId: 'def-purchase_order_line',
    entityType: 'purchase_order_line',
    entitySlug: 'purchase-order-lines',
    fieldId: QTY_FIELD,
    systemAttribute: 'purchase_order_line_quantity_ordered',
    field: { id: QTY_FIELD },
    newValue: { type: 'number', value: 9 },
    existingValue: undefined,
    allValues: new Map(),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
    ...overrides,
  } as unknown as FieldPreHookEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbResults = []
})

describe('evidence lock — what blocks an edit', () => {
  it('locks quantity_ordered once a receipt exists', async () => {
    wireEvidence(['receipt'])
    wireStored(4)
    await expect(guardEvidenceLockedLineFields(event())).rejects.toThrow(ConflictError)
  })

  it('locks expected_unit_price once a vendor bill line exists', async () => {
    wireEvidence(['bill'])
    wireStored(1250)
    await expect(
      guardEvidenceLockedLineFields(
        event({
          systemAttribute: 'purchase_order_line_expected_unit_price',
          newValue: { type: 'number', value: 20000 },
        })
      )
    ).rejects.toThrow(ConflictError)
  })

  // ✅ "Editing lines nothing has happened to stays open at any status" — the half of §6.5
  // that a status predicate would have got wrong.
  it('leaves a line with neither a receipt nor a bill line open', async () => {
    wireEvidence([])
    const next = { type: 'number', value: 9 }
    await expect(guardEvidenceLockedLineFields(event({ newValue: next }))).resolves.toBe(next)
  })

  // A brand-new line has nothing pointing at it, so adding lines to a booked order is never
  // blocked — the evidence probe simply comes back empty.
  it('never blocks a line that has no evidence, whatever the order status', async () => {
    wireEvidence([])
    await expect(guardEvidenceLockedLineFields(event())).resolves.toBeDefined()
    // The probe answered the whole question — no second query was needed.
    expect(h.dbResults).toHaveLength(0)
  })

  it('names both when a receipt and a bill both exist', async () => {
    wireEvidence(['receipt', 'bill'])
    wireStored(4)
    await expect(guardEvidenceLockedLineFields(event())).rejects.toThrow(
      /a receipt and a vendor bill/
    )
  })

  it('names only the receipt when only a receipt exists', async () => {
    wireEvidence(['receipt'])
    wireStored(4)
    await expect(guardEvidenceLockedLineFields(event())).rejects.toThrow(
      /a receipt has already been booked/
    )
  })

  it('names the field being edited, so the message is actionable', async () => {
    wireEvidence(['bill'])
    wireStored(1250)
    await expect(
      guardEvidenceLockedLineFields(
        event({
          systemAttribute: 'purchase_order_line_expected_unit_price',
          newValue: { type: 'number', value: 20000 },
        })
      )
    ).rejects.toThrow(/expected unit price/)
  })

  it('blocks clearing the value, not just changing it', async () => {
    wireEvidence(['receipt'])
    wireStored(4)
    await expect(guardEvidenceLockedLineFields(event({ newValue: null }))).rejects.toThrow(
      ConflictError
    )
  })
})

describe('evidence lock — what it lets through', () => {
  // A re-import, or any surface that submits a whole line rather than a patch, restates
  // these fields unchanged. Refusing that would block edits to the line's description.
  it('allows a write that restates the stored value unchanged', async () => {
    wireEvidence(['receipt', 'bill'])
    wireStored(9)
    const next = { type: 'number', value: 9 }
    await expect(guardEvidenceLockedLineFields(event({ newValue: next }))).resolves.toBe(next)
  })

  it('treats a bare scalar and a typed envelope as the same value', async () => {
    wireEvidence(['receipt'])
    wireStored(9)
    await expect(guardEvidenceLockedLineFields(event({ newValue: 9 }))).resolves.toBe(9)
  })

  it('unwraps a single-element array before comparing', async () => {
    wireEvidence(['receipt'])
    wireStored(9)
    const next = [{ type: 'number', value: 9 }]
    await expect(guardEvidenceLockedLineFields(event({ newValue: next }))).resolves.toBe(next)
  })

  // Purchasing may not be provisioned — no relationship fields means no evidence to find,
  // and the guard must not become an outage.
  it('is inert when the evidence relationship fields do not exist', async () => {
    h.bySystemAttributes.mockResolvedValue({})
    const next = { type: 'number', value: 9 }
    await expect(guardEvidenceLockedLineFields(event({ newValue: next }))).resolves.toBe(next)
  })
})

// Registration lives in `field-hooks/__tests__/purchase-order-line-evidence-lock-registration.test.ts`
// — asserting it needs the real `@auxx/database` module graph that `register-hooks.ts` pulls
// in, which this file's narrow schema stub cannot satisfy.
