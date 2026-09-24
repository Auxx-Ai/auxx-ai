// packages/lib/src/field-hooks/__tests__/money-marks-not-rules.test.ts
//
// plans/accounting/tasks/110-money-marks-not-rules.md §3 M4: money hears about its records
// through mark hooks, so after the real `registerAllHooks()` no `money-*` system rule is
// declared and a sync over the five financial defs fires no rule (writes no `RecordRuleRun`).

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import type { CachedRecordRule } from '../../record-rules/types'

const h = vi.hoisted(() => ({
  rules: [] as CachedRecordRule[],
  getRunManifest: vi.fn(),
  fireRecordRulesBatch: vi.fn(async () => {}),
}))

vi.mock('../../data-connectors/service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRunManifest: h.getRunManifest,
  claimRunManifestConsumed: async () => true,
}))
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedRecordRules: async () => h.rules,
  getCachedResourceFields: async (_org: string, defId: string) =>
    (FIELDS_BY_DEF[defId] ?? []).map((attr) => ({
      id: `fld_${attr}`,
      key: attr,
      systemAttribute: attr,
    })),
}))
vi.mock('../../record-rules/engine', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fireRecordRulesBatch: h.fireRecordRulesBatch,
}))
vi.mock('../../events/handlers/sync-finalize', () => ({ runSyncFinalize: async () => {} }))

import {
  assessOnPayoutChange,
  assessOnProcessorBalanceEntryChange,
  markEvidenceOnCustomerTransactionChange,
  markEvidenceOnLineItemChange,
  markEvidenceOnOrderChange,
} from '../../accounting/money/customer-money/record-marks'
import { handleSyncRecordRules } from '../../events/handlers/handle-sync-record-rules'
import { getSystemRuleDeclarations, resolveSystemRules } from '../../record-rules/system-rules'
import { registerAllHooks } from '../register-hooks'
import { getRegisteredEntityFieldChangeHooks } from '../registry'

const ORG = 'org_1'

/** The five financial defs, by both the slugs a declaration may name. */
const DEFS: Record<string, { slugs: string[]; attrs: string[] }> = {
  def_ct: {
    slugs: ['customer_transaction', 'customer-transactions'],
    attrs: ['customer_transaction_order', 'customer_transaction_amount'],
  },
  def_pbe: {
    slugs: ['processor_balance_entry', 'processor-balance-entries'],
    attrs: ['processor_balance_acquisition_id'],
  },
  def_payout: { slugs: ['payout', 'payouts'], attrs: ['payout_source_membership'] },
  def_order: {
    slugs: ['order', 'orders'],
    attrs: ['order_total', 'order_contact', 'order_currency', 'order_line_items'],
  },
  def_li: { slugs: ['line_item', 'line-items'], attrs: ['line_item_order'] },
}
const FIELDS_BY_DEF = Object.fromEntries(Object.entries(DEFS).map(([id, d]) => [id, d.attrs]))

beforeAll(() => {
  registerAllHooks()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.rules = resolveSystemRules(ORG, getSystemRuleDeclarations(), {
    defIdBySlug: (slug) => Object.entries(DEFS).find(([, d]) => d.slugs.includes(slug))?.[0],
    fieldIdBySystemAttribute: (_defId, attr) => `fld_${attr}`,
  })
})

describe('money rules are gone', () => {
  it('declares no money-* system rule', () => {
    const money = getSystemRuleDeclarations().filter((d) => d.key.startsWith('money-'))
    expect(money).toEqual([])
  })

  it("registers each def's mark hook on its api slug", () => {
    const marks = (slug: string) =>
      getRegisteredEntityFieldChangeHooks(slug)
        .filter((hook) => hook.kind === 'mark')
        .map((hook) => hook.handler)
    expect(marks('customer-transactions')).toContain(markEvidenceOnCustomerTransactionChange)
    expect(marks('line-items')).toContain(markEvidenceOnLineItemChange)
    expect(marks('orders')).toContain(markEvidenceOnOrderChange)
    expect(marks('payouts')).toContain(assessOnPayoutChange)
    expect(marks('processor-balance-entries')).toContain(assessOnProcessorBalanceEntryChange)
  })

  it('a sync manifest over the five financial defs fires no rule', async () => {
    const deltas: Record<string, Record<string, { o: unknown; n: unknown }>> = {}
    for (const [defId, { attrs }] of Object.entries(DEFS))
      deltas[`${defId}:i1`] = Object.fromEntries(attrs.map((a) => [a, { o: 'old', n: 'new' }]))
    const manifest = {
      version: 2,
      detailTruncated: false,
      membershipTruncated: false,
      touched: Object.fromEntries(Object.entries(deltas).map(([rid, b]) => [rid, Object.keys(b)])),
      deltas,
      createdRecordIds: ['def_ct:i2', 'def_pbe:i2', 'def_payout:i2', 'def_li:i2'],
      archivedRecordIds: [],
    } as unknown as SyncChangeManifest
    h.getRunManifest.mockResolvedValue(manifest)

    await handleSyncRecordRules({
      data: {
        type: 'sync:records:changed',
        data: { source: 'connector', organizationId: ORG, runId: 'run_1', ref: 'run_1' },
      } as never,
    })

    expect(h.getRunManifest).toHaveBeenCalled()
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })
})
