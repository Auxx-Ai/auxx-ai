// packages/lib/src/resources/crud/__tests__/list-all-capability-forwarding.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan v3/03 §5.4 — the `listAll` half of the `FieldValueService` threading fix,
 * asserted where it is actually observable: the CONSTRUCTOR OPTIONS.
 *
 * `unified-handler-queries.listAll`'s `ctx` type had no `capabilities` field at
 * all, so it built `new FieldValueService(org, user, db)` — three arguments, no
 * options — and relationship redaction was dropped from every `listAll` payload
 * even when the caller (`record.listAll`, `search`'s tag suggestions) held a fully
 * resolved capability set.
 *
 * Kept in its own file because it mocks the field-values module wholesale, which
 * the sibling threading test needs REAL.
 */

const h = vi.hoisted(() => ({ constructedWith: [] as unknown[] }))

vi.mock('../../../field-values', () => ({
  FieldValueService: class {
    constructor(...args: unknown[]) {
      h.constructedWith.push(args)
    }
    batchGetValues = vi.fn(async () => ({ values: [] }))
    getValuesForEntities = vi.fn(async () => ({}))
  },
  formatToRawValue: vi.fn((v: unknown) => v),
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedResourceFields: vi.fn(async () => []),
  getCachedEntityDefId: vi.fn(async () => null),
  findCachedResource: vi.fn(async () => null),
  getOrgCache: () => ({ get: async () => ({}) }),
}))

const { listAll } = await import('../unified-handler-queries')

/** A stand-in gate surface — only its identity matters to this test. */
const CAPS = { canViewEntity: () => true } as never

const DB = {
  query: { EntityInstance: { findMany: vi.fn(async () => []) } },
} as never

beforeEach(() => {
  h.constructedWith.length = 0
})

describe('listAll — capability forwarding (§5.4)', () => {
  it('passes the caller’s capabilities into the FieldValueService options', async () => {
    await listAll(
      { db: DB, organizationId: 'org_1', userId: 'usr_1', capabilities: CAPS },
      { entityDefinitionId: 'edf_dealscuid00000000000000' }
    )
    const args = h.constructedWith[0] as unknown[]
    expect(args[4]).toEqual({ capabilities: CAPS })
  })

  it('an internal caller with no capabilities stays unenforced', async () => {
    // Absent means "system caller, no enforcement" by design — workers and seeders
    // call this path. Threading must not invent a denial for them.
    await listAll(
      { db: DB, organizationId: 'org_1', userId: 'usr_1' },
      { entityDefinitionId: 'edf_dealscuid00000000000000' }
    )
    const args = h.constructedWith[0] as unknown[]
    expect(args[4]).toEqual({ capabilities: undefined })
  })
})
