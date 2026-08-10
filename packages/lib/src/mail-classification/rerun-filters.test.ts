// packages/lib/src/mail-classification/rerun-filters.test.ts
// §4.1 — the mandatory second pass, and the one detail that must never be
// "tidied": it reuses `source: 'live'`.
//
// The second describe block runs the REAL `fireMailFilters` (only its
// evaluate/claim/execute collaborators are stubbed) so the two pass-2 outcomes
// the plan's table promises are asserted against the actual engine rather than
// against a paraphrase of it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  orgCacheGet: vi.fn(),
  getEnabledMailFiltersForInbox: vi.fn(),
  fireMailFilters: vi.fn(),
  getProviderCapabilities: vi.fn(),
}))

vi.mock('../cache', () => ({ getOrgCache: () => ({ get: h.orgCacheGet }) }))
vi.mock('../mail-filters/cache', () => ({
  getEnabledMailFiltersForInbox: h.getEnabledMailFiltersForInbox,
}))
vi.mock('../mail-filters/engine', () => ({ fireMailFilters: h.fireMailFilters }))
vi.mock('../providers/provider-capabilities', () => ({
  getProviderCapabilities: h.getProviderCapabilities,
}))

import { rerunMailFiltersAfterClassification } from './rerun-filters'

function createDb(rowSets: unknown[][]) {
  let index = 0
  return {
    select: vi.fn(() => {
      const result = Promise.resolve(rowSets[index++] ?? [])
      const step: Record<string, unknown> = {}
      step.from = () => step
      step.where = () => step
      step.limit = () => result
      step.then = (onOk: unknown, onErr: unknown) => result.then(onOk as never, onErr as never)
      return step
    }),
  } as never
}

const THREAD = [{ inboxId: 'ibx_1', integrationId: 'int_1', status: 'OPEN', assigneeId: null }]
const FILTERS = [
  { id: 'flt_a', inboxId: 'ibx_1', name: 'a', order: 0, stopProcessing: false },
  { id: 'flt_b', inboxId: 'ibx_1', name: 'b', order: 1, stopProcessing: false },
]

const params = {
  organizationId: 'org_1',
  threadId: 'thr_1',
  messageId: 'msg_1',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getEnabledMailFiltersForInbox.mockResolvedValue(FILTERS)
  h.getProviderCapabilities.mockReturnValue({ supportsMailFilters: true })
  h.orgCacheGet.mockImplementation(async (_org: string, key: string) => {
    if (key === 'channels') return [{ id: 'int_1', provider: 'google' }]
    if (key === 'inboxes') return [{ id: 'ibx_1', isPersonal: false, ownerUserId: null }]
    return []
  })
  h.fireMailFilters.mockResolvedValue({ suppressAutomations: false, firedFilterIds: ['flt_b'] })
})

describe('rerunMailFiltersAfterClassification', () => {
  it('⚠️ fires with `source: "live"` — a new source arm would re-fire every claimed filter', async () => {
    await rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })

    expect(h.fireMailFilters).toHaveBeenCalledTimes(1)
    expect(h.fireMailFilters.mock.calls[0]?.[0]?.source).toBe('live')
  })

  it('⚠️ passes the FULL filter set, not a tag-referencing subset', async () => {
    await rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })

    expect(h.fireMailFilters.mock.calls[0]?.[0]?.filters).toEqual(FILTERS)
  })

  it('keys the run on the SAME messageId as pass 1, so the claim can dedupe', async () => {
    await rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })

    expect(h.fireMailFilters.mock.calls[0]?.[0]).toMatchObject({
      messageId: 'msg_1',
      threadId: 'thr_1',
      organizationId: 'org_1',
    })
  })

  it('reports what fired', async () => {
    await expect(
      rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })
    ).resolves.toEqual(['flt_b'])
  })

  it('fires nothing when the inbox has no enabled filters', async () => {
    h.getEnabledMailFiltersForInbox.mockResolvedValue([])

    await rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })

    expect(h.fireMailFilters).not.toHaveBeenCalled()
  })

  it('respects the provider capability gate the first pass respects', async () => {
    h.getProviderCapabilities.mockReturnValue({ supportsMailFilters: false })

    await rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })

    expect(h.fireMailFilters).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    h.fireMailFilters.mockRejectedValue(new Error('boom'))

    await expect(
      rerunMailFiltersAfterClassification({ ...params, db: createDb([THREAD]) })
    ).resolves.toEqual([])
  })
})
