// packages/lib/src/entity-instances/__tests__/get-entity-instance-archived.test.ts
//
// `includeArchived` — the flag that makes an archived record reachable again.
//
// 🛑 **Without it, archive was a ONE-WAY DOOR.** This loader excluded any row
// carrying `archivedAt`, and both `restoreEntity` and `deleteEntity` call it
// before doing anything. So `restoreEntity` — whose entire purpose is to clear
// that column — could never load its own target and answered
// `Entity not found` for every record it existed to serve, and a hard delete of
// an archived record failed the same way. An archived row could be neither
// brought back nor purged.
//
// Found 2026-08-31 with DemoOrg1's 9 purchase orders and 9 vendor bills stuck
// behind it. It also made a delete guard's own advice impossible to follow:
// `guardPurchaseOrderDelete` says "delete or unlink the bills first", and the
// API refused to delete them.
//
// The default must stay `false` — every read path wants the archived row hidden,
// and flipping that would surface soft-deleted records across the app.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock('@auxx/database', () => ({
  database: { query: { EntityInstance: { findFirst: h.findFirst } } },
}))

vi.mock('@auxx/services/shared/utils', async () => {
  const { ok } = await import('neverthrow')
  return { fromDatabase: async (p: Promise<unknown>) => ok(await p) }
})

const { getEntityInstance } = await import('../get-entity-instance')

/**
 * Drizzle's relational `where` is a callback over `(table, operators)`. Calling
 * it with recording stubs tells us which predicates were built — the archived
 * one is the whole subject of this file.
 */
function predicatesFor(includeArchived?: boolean): string[] {
  h.findFirst.mockReset()
  h.findFirst.mockReturnValue(Promise.resolve({ id: 'inst_1' }))

  void getEntityInstance({ id: 'inst_1', organizationId: 'org_1', includeArchived })

  const built: string[] = []
  const ops = {
    eq: (col: unknown, _v: unknown) => `eq:${String(col)}`,
    isNull: (col: unknown) => {
      built.push(`isNull:${String(col)}`)
      return `isNull:${String(col)}`
    },
    and: (...args: unknown[]) => args,
  }
  const table = { id: 'id', organizationId: 'organizationId', archivedAt: 'archivedAt' }
  const { where } = h.findFirst.mock.calls[0]![0]
  where(table, ops)
  return built
}

describe('getEntityInstance — the archived predicate', () => {
  it('excludes archived rows by default', () => {
    expect(predicatesFor(undefined)).toContain('isNull:archivedAt')
  })

  it('excludes them on an explicit false too', () => {
    expect(predicatesFor(false)).toContain('isNull:archivedAt')
  })

  it('does NOT exclude them when includeArchived is true', () => {
    // The regression that made restore and hard-delete unreachable.
    expect(predicatesFor(true)).not.toContain('isNull:archivedAt')
  })
})
