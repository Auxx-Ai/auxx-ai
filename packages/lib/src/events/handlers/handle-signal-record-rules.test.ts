// packages/lib/src/events/handlers/handle-signal-record-rules.test.ts
// The signal door dispatcher (Step 3): bot/backfill skip, signalKind filtering, the
// hot-path bail before any EntitySignal read, and the rollup pseudo-field merge. Schema
// is a Proxy (avoids the known Drizzle-columns-undefined-under-vitest gotcha — see
// project memory); drizzle-orm's `and`/`eq`/`inArray` are stubbed so the real query
// builder never runs against the fake columns. Boundaries (cache/engine/resource-fetcher/
// signals-queries) mocked; the pure pseudo-field mapper runs for real via `__test__`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { legacyActionTextToDoc } from '../../record-rules/client'
import type { CachedRecordRule } from '../../record-rules/types'

// Everything a `vi.mock` factory below reads must be created via `vi.hoisted` — a plain
// top-level `const` referenced by a hoisted factory races the SUT's own (hoisted) import
// of the mocked module and throws "Cannot access before initialization".
const h = vi.hoisted(() => {
  const schemaHandler: ProxyHandler<any> = {
    get(_target, tableProp) {
      return new Proxy(
        {},
        {
          get(_t, colProp) {
            return `${String(tableProp)}.${String(colProp)}`
          },
        }
      )
    },
  }
  return {
    mockSchema: new Proxy({}, schemaHandler),
    and: vi.fn((...conds: any[]) => ({ type: 'and', conds })),
    eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
    inArray: vi.fn((col: any, vals: any) => ({ type: 'inArray', col, vals })),
    findMany: vi.fn<() => Promise<any[]>>(),
    getCachedRecordRules: vi.fn<() => Promise<CachedRecordRule[]>>(),
    getCachedEntityDefId: vi.fn<(orgId: string, slug: string) => Promise<string | undefined>>(),
    fireRecordRules: vi.fn<(rules: CachedRecordRule[], ctx: any) => Promise<void>>(async () => {}),
    fetchResourceById: vi.fn<() => Promise<any>>(),
    getSignalRollup: vi.fn<() => Promise<{ ok: true; value: any }>>(),
  }
})

vi.mock('drizzle-orm', () => ({ and: h.and, eq: h.eq, inArray: h.inArray }))
vi.mock('@auxx/database', () => ({
  database: { query: { EntitySignal: { findMany: h.findMany } } },
  schema: h.mockSchema,
}))
vi.mock('../../cache', () => ({
  getCachedRecordRules: h.getCachedRecordRules,
  getCachedEntityDefId: h.getCachedEntityDefId,
}))
vi.mock('../../record-rules/engine', () => ({ fireRecordRules: h.fireRecordRules }))
vi.mock('../../resources/resource-fetcher', () => ({ fetchResourceById: h.fetchResourceById }))
vi.mock('@auxx/types/resource', () => ({
  toRecordId: (defId: string, instId: string) => `${defId}:${instId}`,
}))
vi.mock('../../signals/queries', () => ({ getSignalRollup: h.getSignalRollup }))

import { __test__, handleSignalRecordRules } from './handle-signal-record-rules'

function rule(overrides: Partial<CachedRecordRule> = {}): CachedRecordRule {
  return {
    id: 'rule_1',
    organizationId: 'org_1',
    entityDefinitionId: 'def_contact',
    fieldId: null,
    name: 'r',
    on: 'signal',
    signalKind: 'email:opened',
    condition: [],
    actions: [{ type: 'notify', userIds: ['u1'], message: legacyActionTextToDoc('hi') }],
    enabled: true,
    ...overrides,
  }
}

function signalEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      type: 'signal:recorded',
      data: {
        signalId: 'sig_1',
        organizationId: 'org_1',
        kind: 'email:opened',
        subtype: 'open',
        occurredAt: new Date('2026-01-01'),
        contactEntityInstanceId: 'contact_1',
        recordKeys: ['contact:contact_1'],
        isBot: false,
        backfill: false,
        ...overrides,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([
    { id: 'sig_1', kind: 'email:opened', subtype: 'open', occurredAt: new Date('2026-01-01') },
  ])
  h.getCachedEntityDefId.mockImplementation(async (_orgId, slug) =>
    slug === 'contact' ? 'def_contact' : undefined
  )
  h.getSignalRollup.mockResolvedValue({ ok: true, value: null })
  h.fetchResourceById.mockResolvedValue(null)
})

describe('handleSignalRecordRules', () => {
  it('skips bot-flagged signals before touching the rules cache', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule()])
    await handleSignalRecordRules(signalEvent({ isBot: true }) as never)
    expect(h.getCachedRecordRules).not.toHaveBeenCalled()
    expect(h.fireRecordRules).not.toHaveBeenCalled()
  })

  it('skips backfill signals before touching the rules cache', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule()])
    await handleSignalRecordRules(signalEvent({ backfill: true }) as never)
    expect(h.getCachedRecordRules).not.toHaveBeenCalled()
    expect(h.fireRecordRules).not.toHaveBeenCalled()
  })

  it('filters cached rules by signalKind — a rule on a different kind never fires', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule({ signalKind: 'email:clicked' })])
    await handleSignalRecordRules(signalEvent() as never)
    expect(h.fireRecordRules).not.toHaveBeenCalled()
  })

  it('bails before reading EntitySignal rows when no signal rules match (hot path)', async () => {
    h.getCachedRecordRules.mockResolvedValue([])
    await handleSignalRecordRules(signalEvent() as never)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('tolerates pruned EntitySignal rows (zero rows found) without firing', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule()])
    h.findMany.mockResolvedValue([])
    await handleSignalRecordRules(signalEvent() as never)
    expect(h.fireRecordRules).not.toHaveBeenCalled()
  })

  it('fires matched rules per recordKey through the shared engine path', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule()])
    await handleSignalRecordRules(signalEvent() as never)

    expect(h.fireRecordRules).toHaveBeenCalledTimes(1)
    const [rules, ctx] = h.fireRecordRules.mock.calls[0] as [CachedRecordRule[], any]
    expect(rules).toHaveLength(1)
    expect(ctx).toMatchObject({
      organizationId: 'org_1',
      entityDefinitionId: 'def_contact',
      entityInstanceId: 'contact_1',
      source: 'interactive',
      newValue: { signalId: 'sig_1', kind: 'email:opened', subtype: 'open' },
      // Signal context now carries subtype + ISO occurredAt for action tokens (07).
      signal: {
        signalId: 'sig_1',
        kind: 'email:opened',
        contactEntityInstanceId: 'contact_1',
        subtype: 'open',
        occurredAt: new Date('2026-01-01').toISOString(),
      },
    })
    // No matched rule has conditions — the snapshot fetch is skipped entirely (hot-path).
    expect(ctx.snapshot).toBeUndefined()
    expect(h.fetchResourceById).not.toHaveBeenCalled()
    expect(h.getSignalRollup).not.toHaveBeenCalled()
  })

  it('builds a merged condition snapshot only when a matched rule has conditions', async () => {
    h.getCachedRecordRules.mockResolvedValue([
      rule({ condition: [{ id: 'g1', logicalOperator: 'AND', conditions: [] }] as never }),
    ])
    h.fetchResourceById.mockResolvedValue({ id: 'contact_1', fieldValues: { name: 'Jane' } })
    h.getSignalRollup.mockResolvedValue({ ok: true, value: null })

    await handleSignalRecordRules(signalEvent() as never)

    expect(h.fetchResourceById).toHaveBeenCalledTimes(1)
    const [, ctx] = h.fireRecordRules.mock.calls[0] as [CachedRecordRule[], any]
    // Missing rollup row → no signal:* pseudo-field keys merged in; the real field survives.
    expect(ctx.snapshot.fieldValues).toEqual({ name: 'Jane' })
  })
})

describe('rollupPseudoFieldValues (decision 6)', () => {
  it('merges nothing when the rollup row is missing — "is empty" matches downstream', () => {
    expect(__test__.rollupPseudoFieldValues(null)).toEqual({})
  })

  it('maps rollup columns to their bare (unprefixed) pseudo-field keys', () => {
    const rollup = {
      lastOpenedAt: new Date('2026-01-01'),
      openCount30d: 3,
      lastClickedAt: null,
      clickCount30d: 0,
      lastVisitAt: null,
      visitCount30d: 0,
      lastRepliedAt: null,
      lastSignalAt: new Date('2026-01-01'),
      unsubscribedAt: null,
      bouncedAt: null,
      bounceType: null,
    } as any
    const merged = __test__.rollupPseudoFieldValues(rollup)
    expect(merged.openCount30d).toBe(3)
    expect(merged.lastRepliedAt).toBeNull()
    expect(Object.keys(merged).sort()).toEqual(
      [
        'lastOpenedAt',
        'openCount30d',
        'lastClickedAt',
        'clickCount30d',
        'lastVisitAt',
        'visitCount30d',
        'lastRepliedAt',
        'lastSignalAt',
        'unsubscribedAt',
        'bouncedAt',
        'bounceType',
      ].sort()
    )
  })
})
