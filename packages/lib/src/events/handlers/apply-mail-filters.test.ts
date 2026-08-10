// packages/lib/src/events/handlers/apply-mail-filters.test.ts
// The §4.1 exit ordering. This ordering IS the performance design: an org that
// has never written a filter must pay ZERO queries for the feature on every
// inbound message in the system, so "the thread load was not called" is the
// assertion that matters most in this file.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  select: vi.fn(),
  orgHasEnabledMailFilters: vi.fn(),
  getEnabledMailFiltersForInbox: vi.fn(),
  fireMailFilters: vi.fn(),
  orgCacheGet: vi.fn(),
}))

// Partial mock — a full replacement of `@auxx/database` dies at COLLECTION as
// the import graph grows. The chainable base keeps every other consumer working;
// only `select` is instrumented.
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const base = createChainableDatabaseMock()
  return {
    database: new Proxy(base, {
      get: (target, prop) => (prop === 'select' ? h.select : Reflect.get(target, prop)),
    }),
    schema: createSchemaMock(),
  }
})

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: h.orgCacheGet }),
  getCachedWorkflowAppsByTrigger: vi.fn(async () => []),
}))
vi.mock('../../mail-filters/cache', () => ({
  orgHasEnabledMailFilters: h.orgHasEnabledMailFilters,
  getEnabledMailFiltersForInbox: h.getEnabledMailFiltersForInbox,
}))
vi.mock('../../mail-filters/engine', () => ({ fireMailFilters: h.fireMailFilters }))

import { applyMailFilters } from './apply-mail-filters'

/** `database.select(...).from(...).where(...).limit(...)` resolving to `rows`. */
function threadRows(rows: unknown[]) {
  h.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => rows }) }),
  })
}

const THREAD = {
  inboxId: 'ibx_1',
  integrationId: 'int_1',
  status: 'OPEN',
  assigneeId: null,
}

const FILTER = {
  id: 'flt_a',
  inboxId: 'ibx_1',
  name: 'Newsletters',
  order: 0,
  stopProcessing: false,
  enabled: true,
  conditions: [],
  actions: [],
  templateKey: null,
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      type: 'message:received',
      data: {
        messageId: 'msg_1',
        organizationId: 'org_1',
        threadId: 'thr_1',
        ...overrides,
      },
    },
  } as never
}

/** The `channels` / `inboxes` org-cache reads, in the order the handler makes them. */
function orgCache(options: { provider?: string; personal?: boolean } = {}) {
  h.orgCacheGet.mockImplementation(async (_org: string, key: string) => {
    if (key === 'channels') {
      return [{ id: 'int_1', provider: options.provider ?? 'google' }]
    }
    if (key === 'inboxes') {
      return [{ id: 'ibx_1', isPersonal: options.personal ?? false, ownerUserId: 'usr_1' }]
    }
    return []
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.orgHasEnabledMailFilters.mockResolvedValue(true)
  h.getEnabledMailFiltersForInbox.mockResolvedValue([FILTER])
  h.fireMailFilters.mockResolvedValue({ suppressAutomations: false, firedFilterIds: [] })
  threadRows([THREAD])
  orgCache()
})

describe('applyMailFilters — cheapest-first exits (§4.1)', () => {
  it('1. ignores every event type but message:received', async () => {
    await applyMailFilters({
      data: { type: 'message:sent', data: { messageId: 'm', organizationId: 'org_1' } },
    } as never)

    expect(h.orgHasEnabledMailFilters).not.toHaveBeenCalled()
    expect(h.select).not.toHaveBeenCalled()
  })

  it('2. never fires for hard-tier machine mail (bounces/NDRs)', async () => {
    await applyMailFilters(event({ machineMail: { tier: 'hard', reason: 'ndr' } }))

    expect(h.orgHasEnabledMailFilters).not.toHaveBeenCalled()
    expect(h.select).not.toHaveBeenCalled()
  })

  it('3. exits on a payload with no threadId', async () => {
    await applyMailFilters(event({ threadId: undefined }))

    expect(h.orgHasEnabledMailFilters).not.toHaveBeenCalled()
    expect(h.select).not.toHaveBeenCalled()
  })

  it('4. an org with no enabled filters performs ZERO DB queries', async () => {
    h.orgHasEnabledMailFilters.mockResolvedValue(false)

    await applyMailFilters(event())

    // The whole point of the ordering: the org-cache read comes BEFORE the one
    // thread load, so the feature costs untouched orgs nothing.
    expect(h.orgHasEnabledMailFilters).toHaveBeenCalledWith('org_1')
    expect(h.select).not.toHaveBeenCalled()
    expect(h.fireMailFilters).not.toHaveBeenCalled()
  })

  it('5. loads the thread exactly once when the org does have filters', async () => {
    await applyMailFilters(event())
    expect(h.select).toHaveBeenCalledTimes(1)
  })

  it('5b. exits when the thread is gone or has no inbox', async () => {
    threadRows([])
    await applyMailFilters(event())
    expect(h.getEnabledMailFiltersForInbox).not.toHaveBeenCalled()
  })

  it('6. exits when the thread’s inbox has no enabled filters — before the provider read', async () => {
    h.getEnabledMailFiltersForInbox.mockResolvedValue([])

    await applyMailFilters(event())

    expect(h.orgCacheGet).not.toHaveBeenCalled()
    expect(h.fireMailFilters).not.toHaveBeenCalled()
  })

  it('7. exits when the channel’s provider is not filter-capable', async () => {
    orgCache({ provider: 'chat' })

    await applyMailFilters(event())

    expect(h.fireMailFilters).not.toHaveBeenCalled()
  })

  it('7b. fires for an email-capable provider', async () => {
    await applyMailFilters(event())

    expect(h.fireMailFilters).toHaveBeenCalledTimes(1)
    expect(h.fireMailFilters.mock.calls[0]?.[0]).toMatchObject({
      organizationId: 'org_1',
      threadId: 'thr_1',
      messageId: 'msg_1',
      source: 'live',
      filters: [FILTER],
    })
  })

  it('7c. an unknown provider fails closed', async () => {
    h.orgCacheGet.mockImplementation(async (_org: string, key: string) =>
      key === 'channels' ? [{ id: 'int_1', provider: 'martian-post' }] : []
    )

    await applyMailFilters(event())

    expect(h.fireMailFilters).not.toHaveBeenCalled()
  })
})

describe('applyMailFilters — the suppress list', () => {
  it('returns nothing when no matched filter asked to suppress', async () => {
    await expect(applyMailFilters(event())).resolves.toBeUndefined()
  })

  it('names the automation handlers by their function names, not literals', async () => {
    h.fireMailFilters.mockResolvedValue({
      suppressAutomations: true,
      firedFilterIds: ['flt_a'],
    })

    const result = await applyMailFilters(event())

    // Must match the `then` entries in `publish-event-job.ts` exactly, and must
    // NOT include the bookkeeping handlers — a filter cannot make mail vanish
    // from the timeline or break bounce handling.
    expect(result).toEqual({
      suppress: ['triggerMessageWorkflows', 'enqueueMailClassification'],
    })
  })

  it('suppresses AI classification — the only BILLED handler in the fan-out', async () => {
    h.fireMailFilters.mockResolvedValue({
      suppressAutomations: true,
      firedFilterIds: ['flt_a'],
    })

    const result = await applyMailFilters(event())

    // Separate from the test above on purpose. That one pins the whole list and
    // would happily go green if someone "simplified" it back to one entry while
    // updating the expectation. This one states the standalone rule: a user who
    // said "suppress automations" must not be charged for an inference on the
    // exact mail they said it about.
    expect(result?.suppress).toContain('enqueueMailClassification')
  })

  it('never suppresses the bookkeeping handlers', async () => {
    h.fireMailFilters.mockResolvedValue({
      suppressAutomations: true,
      firedFilterIds: ['flt_a'],
    })

    const result = await applyMailFilters(event())

    for (const bookkeeping of [
      'createTimelineEvent',
      'deriveMessageReplySignal',
      'ingestBounceMessage',
    ]) {
      expect(result?.suppress).not.toContain(bookkeeping)
    }
  })

  it('passes the personal-inbox owner through for the set-read branch', async () => {
    orgCache({ personal: true })

    await applyMailFilters(event())

    expect(h.fireMailFilters.mock.calls[0]?.[0]?.inbox).toEqual({
      id: 'ibx_1',
      isPersonal: true,
      ownerUserId: 'usr_1',
    })
  })
})
