// packages/lib/src/entity-instances/__tests__/updated-at-stamp.test.ts
//
// D-7 (plans/events/03-write-context-and-batch-lane-plan.md §1):
// `EntityInstance.updatedAt` carries no `$onUpdate` anymore — it means
// "record CONTENT changed" and is stamped explicitly. These tests pin the
// stamp-or-not decisions in this directory: archive/restore STAMPS
// (updateEntityInstance), the activity/interaction touches are bookkeeping
// and must NOT include `updatedAt` in their write payloads.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `update(...).set(payload)` this file's code under test issues. */
  setPayloads: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../cache/singletons', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({ contact_employer: null }),
    }),
  }),
}))

vi.mock('drizzle-orm', () => {
  const passthrough = (...a: unknown[]) => a
  return {
    and: passthrough,
    or: passthrough,
    eq: passthrough,
    inArray: passthrough,
    isNotNull: passthrough,
    sql: Object.assign(passthrough, { raw: passthrough }),
  }
})

vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../../test/database-mock')
  const schema = createSchemaMock()

  const database = {
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        h.setPayloads.push(payload)
        return {
          where: () => {
            // `updateEntityInstance` chains `.returning()`; the touches await
            // `.where()` directly — a settled promise carrying a `returning`
            // method supports both shapes without a hand-rolled thenable.
            const settled = Promise.resolve(undefined) as Promise<undefined> & {
              returning: () => Promise<unknown[]>
            }
            settled.returning = () => Promise.resolve([{ id: 'inst-1', ...payload }])
            return settled
          },
        }
      },
    }),
  }

  return { database, schema, Database: class {}, Transaction: class {} }
})

// `updateEntityInstance` wraps its query in `fromDatabase` — reduce it to a
// pass-through Result so the fake chain's `.returning()` rows come back as-is.
vi.mock('@auxx/services/shared/utils', () => ({
  fromDatabase: async (query: Promise<unknown>) => {
    const value = await query
    return { isErr: () => false, isOk: () => true, value }
  },
}))

import { touchEntityActivity, touchEntityInteraction } from '../activity'
import { updateEntityInstance } from '../update-entity-instance'

const ORG = 'org_1'

beforeEach(() => {
  h.setPayloads.length = 0
})

describe('D-7 stamp-or-not decisions', () => {
  it('archive stamps updatedAt explicitly', async () => {
    const result = await updateEntityInstance({
      id: 'inst-1',
      organizationId: ORG,
      data: { archivedAt: new Date('2026-08-21T10:00:00Z') },
    })

    expect(result.isOk()).toBe(true)
    expect(h.setPayloads).toHaveLength(1)
    const payload = h.setPayloads[0]!
    expect(payload.updatedAt).toBeInstanceOf(Date)
    expect(payload.archivedAt).toEqual(new Date('2026-08-21T10:00:00Z'))
    // Archive/restore also advances lastActivityAt (staleness scanner).
    expect(payload.lastActivityAt).toBeInstanceOf(Date)
  })

  it('restore stamps updatedAt explicitly', async () => {
    await updateEntityInstance({
      id: 'inst-1',
      organizationId: ORG,
      data: { archivedAt: null },
    })

    expect(h.setPayloads).toHaveLength(1)
    expect(h.setPayloads[0]!.updatedAt).toBeInstanceOf(Date)
    expect(h.setPayloads[0]!.archivedAt).toBeNull()
  })

  it('touchEntityActivity does NOT stamp updatedAt (bookkeeping)', async () => {
    await touchEntityActivity(['inst-1'], ORG, new Date('2026-08-21T10:00:00Z'))

    expect(h.setPayloads).toHaveLength(1)
    expect(h.setPayloads[0]).toEqual({ lastActivityAt: new Date('2026-08-21T10:00:00Z') })
    expect('updatedAt' in h.setPayloads[0]!).toBe(false)
  })

  it('touchEntityInteraction does NOT stamp updatedAt (bookkeeping)', async () => {
    await touchEntityInteraction(['inst-1'], ORG, 'msg-1', new Date('2026-08-21T10:00:00Z'))

    // Two UPDATEs: first-wins pair and last-wins pair — neither carries updatedAt.
    expect(h.setPayloads).toHaveLength(2)
    for (const payload of h.setPayloads) {
      expect('updatedAt' in payload).toBe(false)
    }
  })
})
