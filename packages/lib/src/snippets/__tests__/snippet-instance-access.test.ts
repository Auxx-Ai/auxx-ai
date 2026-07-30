// packages/lib/src/snippets/__tests__/snippet-instance-access.test.ts

/**
 * Replaces `snippet-sharing.test.ts` (plan 36 §6). Both of its subjects are
 * gone: `resolveCanEdit` was deleted outright (the owner now holds an `admin`
 * `ResourceAccess` row, and its hand-rolled user/profile/group resolution was
 * the drift its own doc comment warned about), and `setSnippetSharing` folded
 * into the shared `resourceAccess.grantInstance` path.
 *
 * What is left to prove is the instance-access wiring:
 *  1. `privateInstanceListScope('snippet')` — the `baselineAtCreate: true` list
 *     filter, on every arm.
 *  2. `listSnippetsForUser` applies that scope BEFORE the query, not after.
 *  3. `createSnippet` writes the owner `admin` row in the SAME transaction as
 *     the snippet (without it the author cannot see what they just created).
 *  4. `listSnippetFoldersWithCounts` scopes its counts to the visible set.
 *
 * Deep relative imports throughout — the `@auxx/lib/permissions` barrel hangs
 * under vitest.
 */

import type { Database } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  privateInstanceListScope,
  type ResolvedRecordAccess,
} from '../../permissions/capabilities/entity-access'

const emitResourceAccessInstanceChanged = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../resource-access', () => ({
  getInstanceAccess: vi.fn(async () => []),
  emitResourceAccessInstanceChanged: (...a: unknown[]) =>
    emitResourceAccessInstanceChanged(...(a as [])),
}))

import { createSnippet } from '../snippet-mutations'
import { listSnippetFoldersWithCounts, listSnippetsForUser } from '../snippet-queries'

/** A minimal `ResolvedRecordAccess` — a full-seat USER with nothing granted. */
function caps(over: Partial<ResolvedRecordAccess> = {}): ResolvedRecordAccess {
  return {
    role: 'USER',
    seatType: 'full',
    keys: new Set(),
    defAccess: {},
    restrictedEntityDefIds: new Set(),
    instanceAccess: {},
    governingInstanceIds: new Set(),
    ...over,
  }
}

describe('privateInstanceListScope — the `baselineAtCreate: true` list filter', () => {
  it('denies everything when the member holds no instance rows', () => {
    // The whole point of `baselineAtCreate: true`: no row ⇒ no access, so an
    // empty allow-list is `none`, NOT "everything except nothing".
    expect(privateInstanceListScope(caps(), 'snippet')).toEqual({ kind: 'none' })
  })

  it('names ONLY the rows that reach `view`', () => {
    const scope = privateInstanceListScope(
      caps({
        governingInstanceIds: new Set(['s_view', 's_admin', 's_none']),
        instanceAccess: {
          s_view: 'read',
          s_admin: 'admin',
          s_none: 'none',
        },
      }),
      'snippet'
    )
    expect(scope.kind).toBe('include')
    expect([...(scope.includeIds ?? [])].sort()).toEqual(['s_admin', 's_view'])
  })

  it('ignores the AREA level entirely — an explicit row beats a closed area', () => {
    // `effectiveInstanceLevel` never consults the area for a row-bearing
    // instance, so neither may the list filter, or a share to a sparse-profile
    // member would be inert in the list but honoured on the detail route.
    const scope = privateInstanceListScope(
      caps({
        keys: new Set(),
        governingInstanceIds: new Set(['s1']),
        instanceAccess: { s1: 'read' },
      }),
      'snippet'
    )
    expect(scope).toEqual({ kind: 'include', includeIds: ['s1'] })
  })

  it('an OWNER is filtered like anyone else — their own snippets only', () => {
    // User decision 2026-07-28 (plan 36 §0.6 revised): the §0.10 bypass is scoped
    // to `baselineAtCreate: false`, so it does not reach a member's private
    // snippet. An owner with no rows lists nothing...
    expect(privateInstanceListScope(caps({ role: 'OWNER' }), 'snippet')).toEqual({ kind: 'none' })

    // ...and an owner WITH a row lists exactly that row. `s_mine` is the `admin`
    // row `createSnippet` writes them at create; `s_theirs` is another member's
    // private snippet, present in the ORG-wide restricted set but carrying no
    // row for this owner.
    expect(
      privateInstanceListScope(
        caps({
          role: 'OWNER',
          governingInstanceIds: new Set(['s_mine', 's_theirs']),
          instanceAccess: { s_mine: 'admin' },
        }),
        'snippet'
      )
    ).toEqual({ kind: 'include', includeIds: ['s_mine'] })
  })

  it('a worker seat sees nothing, even on a snippet it holds `admin` on', () => {
    // Plan 36 decision 0.5 — `Area.snippets` is deliberately outside
    // `WORKER_AREAS`, and the seat ceiling is checked ABOVE the row branch.
    const scope = privateInstanceListScope(
      caps({
        seatType: 'worker',
        governingInstanceIds: new Set(['s1']),
        instanceAccess: { s1: 'admin' },
      }),
      'snippet'
    )
    expect(scope).toEqual({ kind: 'none' })
  })

  it('an org ADMIN gets no bypass', () => {
    // Decision 0.6 — only OWNER short-circuits. An admin who is not a grantee
    // resolves exactly like any other member.
    expect(privateInstanceListScope(caps({ role: 'ADMIN' }), 'snippet')).toEqual({ kind: 'none' })
  })
})

describe('listSnippetsForUser — the scope is applied before the read', () => {
  it('returns an empty list WITHOUT querying when the scope is `none`', async () => {
    const findMany = vi.fn(async () => [])
    const db = { query: { Snippet: { findMany } } } as unknown as Database

    const result = await listSnippetsForUser(
      db,
      'org1',
      'u1',
      { kind: 'none' },
      {
        includeShared: true,
      }
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toEqual([])
    // A post-filter implementation would have had to read the rows first.
    expect(findMany).not.toHaveBeenCalled()
  })

  it('does not count the owner’s own `admin` row as a share', async () => {
    // Every snippet is born with one (`baselineAtCreate: true`), so counting raw
    // rows would report every private snippet as "shared with 1".
    const rows = [
      { snippetId: 's1', granteeType: ResourceGranteeType.user, granteeId: 'u1' },
      { snippetId: 's1', granteeType: ResourceGranteeType.user, granteeId: 'u2' },
      { snippetId: 's1', granteeType: ResourceGranteeType.group, granteeId: 'g1' },
    ]
    const db = {
      query: {
        Snippet: {
          findMany: vi.fn(async () => [{ id: 's1', createdById: 'u1' }]),
        },
      },
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Database

    const result = await listSnippetsForUser(
      db,
      'org1',
      'u1',
      { kind: 'include', includeIds: ['s1'] },
      { includeShared: true }
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value[0]?._count.shares).toBe(2)
  })
})

describe('listSnippetFoldersWithCounts — counts follow the visible set', () => {
  function makeFolderDb(counts: unknown[], onCount: () => void) {
    return {
      query: {
        SnippetFolder: { findMany: vi.fn(async () => [{ id: 'f1', name: 'A' }]) },
      },
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => {
              onCount()
              return counts
            },
          }),
        }),
      }),
    } as unknown as Database
  }

  it('reports zero — without a count query — when the caller sees no snippets', async () => {
    // The leak this closes: before plan 36 the count was org-wide, so a member
    // who could see nothing still learned how many private snippets each folder
    // held.
    const counted = vi.fn()
    const db = makeFolderDb([{ folderId: 'f1', count: 7 }], counted)

    const result = await listSnippetFoldersWithCounts(db, 'org1', { kind: 'none' })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value[0]?._count.snippets).toBe(0)
    expect(counted).not.toHaveBeenCalled()
  })

  it('reports the scoped count when the caller can see some', async () => {
    const db = makeFolderDb([{ folderId: 'f1', count: 2 }], () => {})
    const result = await listSnippetFoldersWithCounts(db, 'org1', {
      kind: 'include',
      includeIds: ['s1', 's2'],
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value[0]?._count.snippets).toBe(2)
  })
})

describe('createSnippet — the owner admin row is part of the create', () => {
  beforeEach(() => {
    emitResourceAccessInstanceChanged.mockReset()
  })

  /**
   * `db.transaction` captures every `insert().values()` payload in call order.
   * Drizzle table objects are undefined under vitest, so the ORDER of the two
   * inserts is what identifies them, not the table reference.
   */
  function makeCreateDb(inserts: unknown[], opts: { transactional?: boolean } = {}) {
    const record = { transactional: false }
    const tx = {
      insert: () => ({
        values: (payload: unknown) => {
          inserts.push(payload)
          return {
            returning: async () => [{ id: 's_new' }],
            onConflictDoNothing: async () => {
              record.transactional = opts.transactional ?? true
            },
          }
        },
      }),
    }
    const db = {
      transaction: async (cb: (t: typeof tx) => Promise<string>) => cb(tx),
      query: {
        Snippet: { findFirst: vi.fn(async () => ({ id: 's_new', title: 'T' })) },
        SnippetFolder: { findFirst: vi.fn(async () => ({ id: 'f1' })) },
      },
    }
    return { db: db as unknown as Database, record }
  }

  it('writes an `admin` ResourceAccess row for the author in the same transaction', async () => {
    const inserts: unknown[] = []
    const { db, record } = makeCreateDb(inserts)

    const result = await createSnippet(db, 'org1', 'u1', { title: 'T', content: 'C' })

    expect(result.isOk()).toBe(true)
    expect(inserts).toHaveLength(2)
    expect(inserts[0]).toMatchObject({ title: 'T', organizationId: 'org1', createdById: 'u1' })
    expect(inserts[1]).toMatchObject({
      organizationId: 'org1',
      entityDefinitionId: 'snippet',
      entityInstanceId: 's_new',
      granteeType: ResourceGranteeType.user,
      granteeId: 'u1',
      rung: 'admin',
    })
    // Both inserts came off the transaction handle, not the bare db.
    expect(record.transactional).toBe(true)
  })

  it('never writes a `role:org_member` baseline — a snippet is private at birth', async () => {
    // Dashboards writes one (shared-by-default); snippets deliberately do not.
    const inserts: unknown[] = []
    const { db } = makeCreateDb(inserts)
    await createSnippet(db, 'org1', 'u1', { title: 'T', content: 'C' })
    expect(
      inserts.some((i) => (i as { granteeType?: string }).granteeType === ResourceGranteeType.role)
    ).toBe(false)
  })

  it('busts the capability caches for the author AFTER the transaction commits', async () => {
    // Without this the author cannot see the snippet they just made: `snippet`
    // is `baselineAtCreate: true`, so a stale `governingInstanceIds` blob has
    // no row for the new id and `effectiveInstanceLevel` returns undefined.
    const { db } = makeCreateDb([])
    await createSnippet(db, 'org1', 'u1', { title: 'T', content: 'C' })
    expect(emitResourceAccessInstanceChanged).toHaveBeenCalledWith(
      'org1',
      [{ granteeType: ResourceGranteeType.user, granteeId: 'u1' }],
      'snippet'
    )
  })
})
