// packages/lib/src/inboxes/inbox-access-through-rows.test.ts

import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §4.2 — the three `vis.isAdmin` short-circuits in `InboxService`
 * (`getInboxesForUser`, `hasUserAccess`, `canManageInboxAccess`) are deleted.
 *
 * The methods are exercised through `InboxService.prototype` rather than a
 * constructed service: the constructor wires a `UnifiedCrudHandler` and the whole
 * CRUD dependency graph, none of which these three predicates touch. What they DO
 * touch — the cached `userMailVisibility` floor and `hasPermission` — is
 * substituted, so each case is a statement about the predicate itself.
 */

const h = vi.hoisted(() => ({
  vis: { isAdmin: false, inboxLens: {} as Record<string, string> },
  hasPermission: vi.fn(async () => false),
}))

vi.mock('../cache', () => ({
  getUserCache: () => ({ get: async () => h.vis }),
  getCachedEntityDefId: vi.fn(async () => 'def_1'),
  onCacheEvent: vi.fn(async () => {}),
}))

vi.mock('../resource-access/resource-access-service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPermission: (...a: unknown[]) => h.hasPermission(...(a as [])),
}))

const { InboxService } = await import('./inbox-service')

type Svc = {
  organizationId: string
  ctx: Record<string, unknown>
  getInboxes: () => Promise<Array<{ id: string }>>
}

const ORG = 'org_1'
const USER = 'u_1'
const A = 'ibx_a'
const B = 'ibx_b'

const svc = (inboxes: string[] = [A, B]): Svc => ({
  organizationId: ORG,
  ctx: { db: {}, organizationId: ORG, userId: USER },
  getInboxes: async () => inboxes.map((id) => ({ id })),
})

const call = <K extends 'getInboxesForUser' | 'hasUserAccess' | 'canManageInboxAccess'>(
  method: K,
  ...args: unknown[]
) =>
  (InboxService.prototype[method] as unknown as (...a: unknown[]) => Promise<unknown>).apply(
    svc(),
    args
  )

beforeEach(() => {
  h.vis = { isAdmin: false, inboxLens: {} }
  h.hasPermission.mockReset()
  h.hasPermission.mockResolvedValue(false)
})

describe('InboxService.getInboxesForUser', () => {
  it('lists exactly the inboxes the composed floor names — rank buys nothing', async () => {
    h.vis = { isAdmin: true, inboxLens: { [A]: 'full' } }
    expect(await call('getInboxesForUser', USER)).toEqual([{ id: A }])
  })

  it('POSITIVE CONTROL: a default admin still gets everything, via the floor', async () => {
    // What `composeUserMailVisibility` produces for `inboxes: Full`.
    h.vis = { isAdmin: true, inboxLens: { [A]: 'full', [B]: 'full' } }
    expect(await call('getInboxesForUser', USER)).toEqual([{ id: A }, { id: B }])
  })

  it('a downgraded admin gets nothing', async () => {
    h.vis = { isAdmin: true, inboxLens: {} }
    expect(await call('getInboxesForUser', USER)).toEqual([])
  })
})

describe('InboxService.hasUserAccess', () => {
  const rid = (id: string) => toRecordId('inbox', id) as RecordId

  it('is the floor read, with no rank arm', async () => {
    h.vis = { isAdmin: true, inboxLens: { [A]: 'metadata' } }
    expect(await call('hasUserAccess', rid(A), USER)).toBe(true)
    expect(await call('hasUserAccess', rid(B), USER)).toBe(false)
  })
})

describe('InboxService.canManageInboxAccess', () => {
  const rid = toRecordId('inbox', A) as RecordId

  it('refuses an ADMIN with no Manager row, and really consults the rows', async () => {
    h.vis = { isAdmin: true, inboxLens: { [A]: 'full' } }
    expect(await call('canManageInboxAccess', rid, USER)).toBe(false)
    expect(h.hasPermission).toHaveBeenCalledTimes(1)
  })

  it('POSITIVE CONTROL: a non-admin Manager passes', async () => {
    h.vis = { isAdmin: false, inboxLens: {} }
    h.hasPermission.mockResolvedValue(true)
    expect(await call('canManageInboxAccess', rid, USER)).toBe(true)
  })
})
