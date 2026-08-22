// packages/lib/src/events/handlers/finalize-integrity-passes.test.ts
// Phase 5 integrity batch passes (plan events/03 §8 step 4, bug B-1): manifest → def/field
// resolution, distinct-parent totals recompute, bounded-concurrency address normalize,
// phone-geo fill, and the never-throws contract. Boundaries (cache, hook cores, field-value
// read path) are mocked with plain synchronous factories — same conventions as
// sync-finalize.test.ts and the hooks' own suites (async importOriginal factories do not
// reliably apply here; see address-normalize-hook.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'

const h = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedCustomFields: vi.fn(),
  recomputeLineTotal: vi.fn(async () => {}),
  resolveLineParentDocument: vi.fn(async (): Promise<unknown> => null),
  recomputeTotals: vi.fn(async () => {}),
  runNormalize: vi.fn(async () => {}),
  fillBlankGeoFields: vi.fn(async () => {}),
  lookupPhoneGeo: vi.fn(),
  getValue: vi.fn(),
}))

// Cache barrel — mocked whole, like sync-finalize.test.ts (the lazy import means the real
// barrel, which drags the Redis client, is never loaded).
vi.mock('../../cache', () => ({
  findCachedResource: h.findCachedResource,
  getCachedCustomFields: h.getCachedCustomFields,
}))

// Totals cores + the trigger vocabularies (literal copies — the sets are plain data; the
// real ones live in money/totals-hooks.ts and are covered by the money suites).
vi.mock('../../money/totals-hooks', () => ({
  LINE_TRIGGER_ATTRS: new Set([
    'line_item_qty',
    'line_item_unit_price',
    'line_item_taxable',
    'line_item_discount',
    'line_item_optional',
    'line_item_optional_selected',
    'line_item_quote',
    'line_item_work_order',
    'line_item_invoice',
  ]),
  LINE_TOTAL_TRIGGER_ATTRS: new Set(['line_item_qty', 'line_item_unit_price']),
  QUOTE_TRIGGER_ATTRS: new Set(['quote_discount_type', 'quote_discount_value', 'quote_tax_rate']),
  INVOICE_TRIGGER_ATTRS: new Set([
    'invoice_discount_type',
    'invoice_discount_value',
    'invoice_tax_rate',
  ]),
  recomputeLineTotal: h.recomputeLineTotal,
  resolveLineParentDocument: h.resolveLineParentDocument,
  recomputeTotals: h.recomputeTotals,
}))

// Address hook core + its pure guards — hand-rolled minimal stand-ins faithful to the real
// implementations (which the geocoding suite covers); `runNormalize` is the observable seam.
vi.mock('../../geocoding/address-normalize-hook', () => {
  const COMPONENT_KEYS = ['street1', 'street2', 'city', 'state', 'zipCode', 'country']
  const extractStruct = (value: unknown): Record<string, unknown> | null => {
    const first = Array.isArray(value) ? value[0] : value
    if (!first || typeof first !== 'object') return null
    const inner = (first as { value?: unknown }).value
    return inner && typeof inner === 'object' && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : null
  }
  return {
    extractStruct,
    isNonEmptyStruct: (struct: Record<string, unknown> | null) =>
      !!struct &&
      COMPONENT_KEYS.some((key) => typeof struct[key] === 'string' && struct[key].trim() !== ''),
    hasStampedGeocode: (struct: Record<string, unknown>) =>
      typeof struct.lat === 'number' &&
      typeof struct.lng === 'number' &&
      typeof struct.geocodedAt === 'string',
    runNormalize: h.runNormalize,
  }
})

vi.mock('../../phone-geo/derive-geo-hook', () => ({
  extractPrimaryPhone: (value: unknown): string | null => {
    const first = Array.isArray(value) ? value[0] : value
    const raw = first && typeof first === 'object' ? (first as { value?: unknown }).value : null
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null
  },
  fillBlankGeoFields: h.fillBlankGeoFields,
}))
vi.mock('../../phone-geo/lookup', () => ({ lookupPhoneGeo: h.lookupPhoneGeo }))

vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: vi.fn((organizationId: string, userId: string, db: unknown) => ({
    organizationId,
    userId,
    db,
  })),
}))
vi.mock('../../field-values/field-value-queries', () => ({ getValue: h.getValue }))

import { runIntegrityPasses } from './finalize-integrity-passes'

const ORG = 'org_1'
const DB = { tag: 'db' } as never

/** The org's resources, addressable by entityType, apiSlug, or def CUID. */
const RESOURCES = [
  { entityDefinitionId: 'def_li', entityType: 'line_item', apiSlug: 'line-items' },
  { entityDefinitionId: 'def_contact', entityType: 'contact', apiSlug: 'contacts' },
  { entityDefinitionId: 'def_quote', entityType: 'quote', apiSlug: 'quotes' },
  { entityDefinitionId: 'def_invoice', entityType: 'invoice', apiSlug: 'invoices' },
  { entityDefinitionId: 'def_ticket', entityType: 'ticket', apiSlug: 'tickets' },
]

const FIELDS_BY_DEF: Record<string, Array<Record<string, unknown>>> = {
  def_li: [
    { id: 'fld_qty', systemAttribute: 'line_item_qty', type: 'NUMBER' },
    { id: 'fld_inv_rel', systemAttribute: 'line_item_invoice', type: 'RELATIONSHIP' },
  ],
  def_contact: [
    // Custom field — no systemAttribute, so its manifest outputKey is the field id.
    {
      id: 'fld_addr',
      systemAttribute: null,
      type: 'ADDRESS_STRUCT',
      entityDefinitionId: 'def_contact',
    },
    {
      id: 'fld_phone',
      systemAttribute: 'phone',
      type: 'PHONE_INTL',
      entityDefinitionId: 'def_contact',
    },
  ],
  def_quote: [{ id: 'fld_qtax', systemAttribute: 'quote_tax_rate', type: 'NUMBER' }],
  def_invoice: [],
  def_ticket: [{ id: 'fld_subj', systemAttribute: 'ticket_subject', type: 'TEXT' }],
}

function manifest(changes: Record<string, Record<string, { o?: unknown; n: unknown }>>) {
  return {
    version: 1,
    truncated: false,
    changes,
    createdRecordIds: [],
    archivedRecordIds: [],
  } as unknown as SyncChangeManifest
}

function run(m: SyncChangeManifest) {
  return runIntegrityPasses(DB, { organizationId: ORG, manifest: m })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findCachedResource.mockImplementation(async (_org: string, key: string) => {
    return (
      RESOURCES.find(
        (r) => r.entityDefinitionId === key || r.entityType === key || r.apiSlug === key
      ) ?? null
    )
  })
  h.getCachedCustomFields.mockImplementation(
    async (_org: string, defId: string) => FIELDS_BY_DEF[defId] ?? []
  )
  h.resolveLineParentDocument.mockResolvedValue(null)
  h.lookupPhoneGeo.mockReturnValue(null)
  // Fresh stored values per field: an unstamped address struct and a multi phone.
  h.getValue.mockImplementation(async (_ctx: unknown, params: { fieldId: string }) => {
    if (params.fieldId === 'fld_addr') {
      return { id: 'fv1', type: 'json', value: { street1: '123 Fresh St', city: 'Austin' } }
    }
    if (params.fieldId === 'fld_phone') return [{ id: 'fv2', type: 'text', value: '+13102030000' }]
    return null
  })
})

describe('totals pass', () => {
  it('recomputes each distinct parent once — two lines of one invoice → one recompute', async () => {
    h.resolveLineParentDocument.mockResolvedValue({
      documentType: 'invoice',
      documentInstanceId: 'inv1',
    })
    await run(
      manifest({
        'line_item:li1': { line_item_qty: { o: 1, n: 2 } },
        'line_item:li2': { line_item_qty: { n: 5 } },
      })
    )
    expect(h.resolveLineParentDocument).toHaveBeenCalledTimes(2)
    expect(h.recomputeTotals).toHaveBeenCalledTimes(1)
    expect(h.recomputeTotals).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: 'system',
      documentType: 'invoice',
      documentInstanceId: 'inv1',
      db: DB,
    })
  })

  it('rewrites line totals first for qty/unitPrice changes, and skips them for relation-only changes', async () => {
    h.resolveLineParentDocument.mockResolvedValue({
      documentType: 'quote',
      documentInstanceId: 'q1',
    })
    await run(
      manifest({
        'line_item:li1': { line_item_qty: { n: 3 } },
        'line_item:li2': { line_item_invoice: { n: 'invoice:inv1' } },
      })
    )
    expect(h.recomputeLineTotal).toHaveBeenCalledTimes(1)
    expect(h.recomputeLineTotal).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: 'system',
      lineInstanceId: 'li1',
    })
    // The line-total rewrite happened before the parent recompute summed the lines.
    expect(h.recomputeLineTotal.mock.invocationCallOrder[0]!).toBeLessThan(
      h.recomputeTotals.mock.invocationCallOrder[0]!
    )
  })

  it('a quote billing-field change recomputes that quote directly, without line resolution', async () => {
    await run(manifest({ 'quote:q1': { quote_tax_rate: { o: 0, n: 7.5 } } }))
    expect(h.resolveLineParentDocument).not.toHaveBeenCalled()
    expect(h.recomputeTotals).toHaveBeenCalledTimes(1)
    expect(h.recomputeTotals).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'quote', documentInstanceId: 'q1' })
    )
  })

  it('a parentless line (no quote, no invoice) recomputes nothing', async () => {
    await run(manifest({ 'line_item:li1': { line_item_qty: { n: 2 } } }))
    expect(h.recomputeTotals).not.toHaveBeenCalled()
  })
})

describe('address pass', () => {
  it('normalizes the RE-READ stored value, not the manifest snapshot', async () => {
    await run(manifest({ 'contact:c1': { fld_addr: { n: { street1: 'Stale Manifest St' } } } }))
    expect(h.runNormalize).toHaveBeenCalledTimes(1)
    const [event, struct] = h.runNormalize.mock.calls[0]! as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(struct).toEqual({ street1: '123 Fresh St', city: 'Austin' })
    expect(event).toMatchObject({
      organizationId: ORG,
      userId: 'system',
      recordId: 'def_contact:c1',
      entityDefinitionId: 'def_contact',
    })
    expect((event.field as { id: string }).id).toBe('fld_addr')
  })

  it('skips a struct that already carries a geocode stamp (redelivery idempotency)', async () => {
    h.getValue.mockResolvedValue({
      id: 'fv1',
      type: 'json',
      value: { street1: '123 Main', lat: 30.1, lng: -97.1, geocodedAt: '2026-01-01T00:00:00Z' },
    })
    await run(manifest({ 'contact:c1': { fld_addr: { n: { street1: '123 Main' } } } }))
    expect(h.runNormalize).not.toHaveBeenCalled()
  })

  it('skips a value that was cleared after the manifest captured it', async () => {
    h.getValue.mockResolvedValue(null)
    await run(manifest({ 'contact:c1': { fld_addr: { n: { street1: '123 Main' } } } }))
    expect(h.runNormalize).not.toHaveBeenCalled()
  })

  it('geocodes under a bounded pool of 4', async () => {
    let inflight = 0
    let maxInflight = 0
    h.runNormalize.mockImplementation(async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inflight--
    })
    const changes: Record<string, Record<string, { n: unknown }>> = {}
    for (let i = 0; i < 10; i++) {
      changes[`contact:c${i}`] = { fld_addr: { n: { street1: `${i} Main St` } } }
    }
    await run(manifest(changes))
    expect(h.runNormalize).toHaveBeenCalledTimes(10)
    expect(maxInflight).toBe(4)
  })
})

describe('phone-geo pass', () => {
  it('derives from the re-read primary number and hands the geo to the fill core', async () => {
    const geo = { city: 'Los Angeles', region: 'California' }
    h.lookupPhoneGeo.mockReturnValue(geo)
    await run(manifest({ 'contact:c2': { phone: { n: '+13102030000' } } }))
    expect(h.lookupPhoneGeo).toHaveBeenCalledWith('+13102030000')
    expect(h.fillBlankGeoFields).toHaveBeenCalledTimes(1)
    const [event, passedGeo] = h.fillBlankGeoFields.mock.calls[0]! as unknown as [
      Record<string, unknown>,
      unknown,
    ]
    expect(passedGeo).toBe(geo)
    expect(event).toMatchObject({
      organizationId: ORG,
      userId: 'system',
      entityDefinitionId: 'def_contact',
      recordId: 'def_contact:c2',
    })
  })

  it('no-ops when the number resolves to no geo', async () => {
    h.lookupPhoneGeo.mockReturnValue(null)
    await run(manifest({ 'contact:c2': { phone: { n: '+10000000000' } } }))
    expect(h.fillBlankGeoFields).not.toHaveBeenCalled()
  })
})

describe('no matching work', () => {
  it('does nothing for defs with none of the trigger field types', async () => {
    await run(manifest({ 'ticket:t1': { ticket_subject: { o: 'a', n: 'b' } } }))
    expect(h.recomputeLineTotal).not.toHaveBeenCalled()
    expect(h.recomputeTotals).not.toHaveBeenCalled()
    expect(h.runNormalize).not.toHaveBeenCalled()
    expect(h.fillBlankGeoFields).not.toHaveBeenCalled()
    expect(h.getValue).not.toHaveBeenCalled()
  })

  it('does nothing for an empty manifest', async () => {
    await run(manifest({}))
    expect(h.findCachedResource).not.toHaveBeenCalled()
  })

  it('skips records whose def cannot be resolved', async () => {
    h.findCachedResource.mockResolvedValue(null)
    await run(manifest({ 'mystery:m1': { fld_addr: { n: { street1: 'x' } } } }))
    expect(h.runNormalize).not.toHaveBeenCalled()
  })
})

describe('failure isolation', () => {
  const mixedManifest = () =>
    manifest({
      'line_item:li1': { line_item_qty: { n: 2 } },
      'contact:c1': { fld_addr: { n: { street1: '123 Main' } } },
      'contact:c2': { phone: { n: '+13102030000' } },
    })

  it('throwing totals cores never break the address and phone passes', async () => {
    h.recomputeLineTotal.mockRejectedValue(new Error('line boom'))
    h.resolveLineParentDocument.mockRejectedValue(new Error('resolve boom'))
    h.lookupPhoneGeo.mockReturnValue({ city: 'LA' })
    await expect(run(mixedManifest())).resolves.toBeUndefined()
    expect(h.runNormalize).toHaveBeenCalledTimes(1)
    expect(h.fillBlankGeoFields).toHaveBeenCalledTimes(1)
  })

  it('a failing re-read in one pass never rejects, and later passes still run', async () => {
    h.getValue.mockImplementation(async (_ctx: unknown, params: { fieldId: string }) => {
      if (params.fieldId === 'fld_addr') throw new Error('read boom')
      return [{ id: 'fv2', type: 'text', value: '+13102030000' }]
    })
    h.lookupPhoneGeo.mockReturnValue({ city: 'LA' })
    await expect(run(mixedManifest())).resolves.toBeUndefined()
    expect(h.runNormalize).not.toHaveBeenCalled()
    expect(h.fillBlankGeoFields).toHaveBeenCalledTimes(1)
  })

  it('never rejects even when every core fails', async () => {
    h.recomputeTotals.mockRejectedValue(new Error('a'))
    h.recomputeLineTotal.mockRejectedValue(new Error('b'))
    h.resolveLineParentDocument.mockRejectedValue(new Error('c'))
    h.runNormalize.mockRejectedValue(new Error('d'))
    h.fillBlankGeoFields.mockRejectedValue(new Error('e'))
    h.lookupPhoneGeo.mockReturnValue({ city: 'LA' })
    await expect(run(mixedManifest())).resolves.toBeUndefined()
  })
})
