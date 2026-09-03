// packages/lib/src/field-hooks/__tests__/system-record-rules.test.ts
// B2 §8: the manufacturing FIELD_TRIGGERS as server-declared system rules, plus the two
// company-enrichment field doors added in plans/company/v4-enrichment-doors.md. Asserts the
// declarations (keys, transition, ordered actions) and that the native handlers are thin
// wrappers that call the EXISTING trigger functions with an adapted event. Trigger modules
// mocked so no DB/bom/realtime/queue is touched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  recalculatePartCost: vi.fn(async () => {}),
  clearOtherPreferred: vi.fn(async () => {}),
  recalculateStockStatus: vi.fn(async () => {}),
  enqueueCompanyEnrichmentForRecords: vi.fn(async () => {}),
}))

vi.mock('../post/bom-cost-triggers', () => ({ recalculatePartCost: h.recalculatePartCost }))
vi.mock('../post/vendor-part-triggers', () => ({ clearOtherPreferred: h.clearOtherPreferred }))
vi.mock('../post/inventory-triggers', () => ({ recalculateStockStatus: h.recalculateStockStatus }))
vi.mock('../post/company-triggers', () => ({
  enqueueCompanyEnrichmentForRecords: h.enqueueCompanyEnrichmentForRecords,
}))

import { __clearNativeRuleHandlers, getNativeRuleHandler } from '../../record-rules/actions'
import { __clearSystemRules, getSystemRuleDeclarations } from '../../record-rules/system-rules'
import { __resetFieldSystemRulesLatch, registerFieldSystemRules } from '../system-record-rules'

beforeEach(() => {
  vi.clearAllMocks()
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetFieldSystemRulesLatch()
  registerFieldSystemRules()
})

afterEach(() => {
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetFieldSystemRulesLatch()
})

describe('registerFieldSystemRules — declarations', () => {
  it('declares exactly the 13 field triggers', () => {
    const decls = getSystemRuleDeclarations()
    expect(decls).toHaveLength(13)
    expect(decls.map((d) => d.fieldRef?.systemAttribute).sort()).toEqual(
      [
        // Company enrichment's two field doors: a domain arriving or being corrected, and
        // a website the domain can be derived from.
        'company_domain',
        'company_website',
        'part_reorder_point',
        'subpart_quantity',
        // The schedule (29 §7): the three rate-row fields the resolver reads,
        // and the offer's pointer.
        'tariff_rate_authority',
        'tariff_rate_effective_from',
        'tariff_rate_rate',
        'vendor_part_is_preferred',
        'vendor_part_other_cost',
        'vendor_part_shipping_cost',
        'vendor_part_tariff_code',
        'vendor_part_tariff_rate',
        'vendor_part_unit_price',
      ].sort()
    )
    expect(decls.every((d) => d.on === 'changed')).toBe(true)
    expect(decls.every((d) => d.actions.every((a) => a.type === 'native'))).toBe(true)
  })

  it('vendor_part_is_preferred keeps ordered [recalc cost, clear other preferred]', () => {
    const decl = getSystemRuleDeclarations().find(
      (d) => d.fieldRef?.systemAttribute === 'vendor_part_is_preferred'
    )!
    expect(decl.actions.map((a) => (a as { handler: string }).handler)).toEqual([
      'recalculatePartCostFromVendorPart',
      'clearOtherPreferred',
    ])
  })

  it('maps each field to the right def slug', () => {
    const bySlug = (attr: string) =>
      getSystemRuleDeclarations().find((d) => d.fieldRef?.systemAttribute === attr)!.defSlug
    expect(bySlug('vendor_part_unit_price')).toBe('vendor-parts')
    expect(bySlug('vendor_part_tariff_code')).toBe('vendor-parts')
    expect(bySlug('subpart_quantity')).toBe('subparts')
    expect(bySlug('part_reorder_point')).toBe('parts')
    expect(bySlug('tariff_rate_rate')).toBe('tariff-rates')
  })

  it('routes the tariff rate fields to the two-join handler, not the vendor-part one', () => {
    const handlers = getSystemRuleDeclarations()
      .filter((d) => d.defSlug === 'tariff-rates')
      .flatMap((d) => d.actions.map((a) => (a as { handler: string }).handler))
    expect(new Set(handlers)).toEqual(new Set(['recalculatePartCostFromTariffRate']))
  })

  it('is idempotent — a second call does not duplicate declarations', () => {
    __resetFieldSystemRulesLatch()
    registerFieldSystemRules()
    expect(getSystemRuleDeclarations()).toHaveLength(13)
  })
})

describe('company enrichment field doors', () => {
  const companyRules = () => getSystemRuleDeclarations().filter((d) => d.defSlug === 'companies')

  it('declares one rule for company_domain and one for company_website', () => {
    expect(
      companyRules()
        .map((d) => d.fieldRef?.systemAttribute)
        .sort()
    ).toEqual(['company_domain', 'company_website'])
  })

  // 🛑 `'set'` is `isEmpty(old) && !isEmpty(new)`, which misses a CORRECTION (`acme.com`
  // to `acme.io`) — and a correction is exactly when the cached logo and description are
  // wrong. On the interactive door the two behave identically anyway, since the sentinel
  // makes every transition match, so `'set'` would buy nothing and lose the case that
  // matters. (The blanket `on === 'changed'` assertion above covers this too; this names
  // why it must stay true for these two.)
  it('fires on changed, not set, so a domain CORRECTION re-enriches', () => {
    for (const rule of companyRules()) expect(rule.on).toBe('changed')
  })

  // Suppresses the interactive create double-fire — the def's `created` rule owns that
  // case. It does NOT suppress the sync one: `handle-sync-record-rules.ts` never reads the
  // flag, so an import creating a company with a domain fires both. That is absorbed by
  // the BullMQ jobId and the stored status, not here.
  it('skips the create path, leaving it to the lifecycle rule', () => {
    for (const rule of companyRules()) expect(rule.skipOnCreate).toBe(true)
  })

  it('routes each field to its own native handler', () => {
    const byAttr = new Map(
      companyRules().map((d) => [
        d.fieldRef?.systemAttribute,
        d.actions.map((a) => (a as { handler: string }).handler),
      ])
    )
    expect(byAttr.get('company_domain')).toEqual(['enrichCompanyFromDomain'])
    expect(byAttr.get('company_website')).toEqual(['enrichCompanyFromWebsite'])
  })

  // 🛑 NOT routed through `fanOutEntityHandler`: it bails on any firing with no lifecycle
  // `action`, and field firings carry none. Routing them through it would have compiled,
  // registered, and silently never run.
  it('passes the batch recordIds straight through, with no lifecycle action present', async () => {
    await getNativeRuleHandler('enrichCompanyFromDomain')!({
      recordIds: ['companyDef:c1', 'companyDef:c2'] as never,
      organizationId: 'org_1',
    })
    expect(h.enqueueCompanyEnrichmentForRecords).toHaveBeenCalledTimes(1)
    expect(h.enqueueCompanyEnrichmentForRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        recordIds: ['companyDef:c1', 'companyDef:c2'],
      }),
      'domain-changed'
    )
  })

  it('tags the website door with its own reason', async () => {
    await getNativeRuleHandler('enrichCompanyFromWebsite')!({
      recordIds: ['companyDef:c1'] as never,
      organizationId: 'org_1',
    })
    expect(h.enqueueCompanyEnrichmentForRecords).toHaveBeenCalledWith(
      expect.anything(),
      'website-changed'
    )
  })
})

describe('registerFieldSystemRules — native handlers wrap the trigger fns', () => {
  const batchEvent = { recordIds: ['def_vp:i1'] as never, organizationId: 'org_1', userId: 'u1' }

  it('recalculatePartCostFromVendorPart → recalculatePartCost with a vendor_part attribute', async () => {
    await getNativeRuleHandler('recalculatePartCostFromVendorPart')!(batchEvent)
    expect(h.recalculatePartCost).toHaveBeenCalledTimes(1)
    expect(h.recalculatePartCost).toHaveBeenCalledWith({
      action: 'updated',
      systemAttribute: 'vendor_part_unit_price',
      recordIds: ['def_vp:i1'],
      organizationId: 'org_1',
      userId: 'u1',
    })
  })

  it('recalculatePartCostFromSubpart → recalculatePartCost with subpart_quantity', async () => {
    await getNativeRuleHandler('recalculatePartCostFromSubpart')!(batchEvent)
    expect(h.recalculatePartCost).toHaveBeenCalledWith(
      expect.objectContaining({ systemAttribute: 'subpart_quantity' })
    )
  })

  it('clearOtherPreferred + recalculateStockStatus wrap their functions', async () => {
    await getNativeRuleHandler('clearOtherPreferred')!(batchEvent)
    await getNativeRuleHandler('recalculateStockStatus')!(batchEvent)
    expect(h.clearOtherPreferred).toHaveBeenCalledTimes(1)
    expect(h.recalculateStockStatus).toHaveBeenCalledTimes(1)
  })

  it('defaults a missing userId to empty string for type compatibility', async () => {
    await getNativeRuleHandler('recalculatePartCostFromVendorPart')!({
      recordIds: ['def_vp:i1'] as never,
      organizationId: 'org_1',
    })
    expect(h.recalculatePartCost).toHaveBeenCalledWith(expect.objectContaining({ userId: '' }))
  })
})
