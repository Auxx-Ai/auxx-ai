// packages/lib/src/resource-access/mail-sharing-guard-inbox-defs.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureKey } from '../permissions/types'

/**
 * Plan 40 §3 / 40a §4 — the three `mail-sharing-guard` sites that hard-coded the
 * `'inbox'` slug.
 *
 * Data migration 060 moves a personal mailbox onto the `personal_inbox`
 * EntityDefinition and re-keys its `ResourceAccess` rows in the same
 * transaction. Every one of these sites reads those rows, so each must know both
 * keyspaces or the mailbox's own Manager (its owner) stops being recognised:
 *
 * 1. the direct Manager check — a `personal_inbox` RecordId used to fall past the
 *    inbox branch and past the thread branch into the CONTACT throw, so the
 *    denial message is what proves the branch is taken;
 * 2. the thread re-share lookup, which resolves the thread's inbox — now
 *    possibly a personal mailbox — to a Manager check;
 * 3. the `granularPermissions` plan gate on a NEW Manager row.
 */

const h = vi.hoisted(() => ({
  hasPermission: vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => false),
  getThreadLens: vi.fn<(...a: unknown[]) => Promise<string>>(async () => 'read'),
  getCachedUserInstanceGrants: vi.fn(async () => ({ isAdmin: false })),
  requireAccess: vi.fn(async () => {}),
  /** table name → rows the fake `database` returns for a `.limit()` query. */
  rowsByTable: {} as Record<string, unknown[]>,
  /** The merged `inboxes` org-cache list — the def discriminator seam. */
  cachedInboxes: [] as Array<{ id: string; entityDefinitionKey: string }>,
}))

vi.mock('@auxx/database', () => ({
  // Drizzle columns are undefined under vitest (project memory) — a Proxy hands
  // back `Table.column` tokens, which also lets the fake db route by table.
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }) }
  ),
  database: {
    select: () => ({
      from: (table: { id: string }) => ({
        where: () => ({
          limit: async () => h.rowsByTable[String(table.id).split('.')[0] ?? ''] ?? [],
        }),
      }),
    }),
  },
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: (...conds: unknown[]) => ({ and: conds }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}))

vi.mock('../cache', () => ({
  getCachedUserInstanceGrants: (...a: unknown[]) => h.getCachedUserInstanceGrants(...(a as [])),
  getOrgCache: () => ({ get: async () => h.cachedInboxes }),
}))

vi.mock('../permissions/visibility', () => ({
  // The guard resolves the lens for a thread row it (or its caller) already
  // loaded, so it consumes `getLoadedThreadLens` rather than re-selecting through
  // `getThreadLens`.
  getLoadedThreadLens: (...a: unknown[]) => h.getThreadLens(...a),
}))

vi.mock('../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    requireAccess = h.requireAccess
  },
}))

vi.mock('./resource-access-service', () => ({
  hasPermission: (...a: unknown[]) => h.hasPermission(...a),
}))

import { assertCanManageMailSharing, assertMailSharingFeature } from './mail-sharing-guard'

const ORG = 'org_1'

/**
 * `ctx.db` — used by `assertMailSharingFeature`'s existing-Manager probe AND, since
 * the guard stopped reaching for the module-level `database`, by the thread
 * branch's own thread-facts load. The two are told apart by the terminator:
 * the Manager probe awaits `.where()`, the thread load calls `.limit()`.
 */
const existingManagerRows: Array<{ granteeId: string }> = []
const ctx = () =>
  ({
    db: {
      select: () => ({
        from: (table: { id: string }) => ({
          where: () => {
            const rows = h.rowsByTable[String(table.id).split('.')[0] ?? ''] ?? []
            return Object.assign(Promise.resolve(existingManagerRows), {
              limit: async () => rows,
            })
          },
        }),
      }),
    },
    organizationId: ORG,
    userId: 'u_caller',
  }) as any

/** The RecordId `hasPermission` was asked about on its Nth call. */
const askedAbout = (call = 0) => h.hasPermission.mock.calls[call]?.[1]

beforeEach(() => {
  h.hasPermission.mockReset()
  h.hasPermission.mockResolvedValue(false)
  h.getThreadLens.mockReset()
  h.getThreadLens.mockResolvedValue('read')
  h.getCachedUserInstanceGrants.mockReset()
  h.getCachedUserInstanceGrants.mockResolvedValue({ isAdmin: false })
  h.requireAccess.mockReset()
  h.requireAccess.mockResolvedValue(undefined)
  h.rowsByTable = {}
  h.cachedInboxes = []
  existingManagerRows.length = 0
})

describe('assertCanManageMailSharing — personal_inbox is an inbox def', () => {
  it('lets a non-admin Manager of a personal mailbox manage its access', async () => {
    h.hasPermission.mockResolvedValue(true)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('personal_inbox', 'pi_1'))
    ).resolves.toBeUndefined()
    expect(askedAbout()).toBe('personal_inbox:pi_1')
  })

  it('denies a non-Manager with the INBOX message, not the contact fallthrough', async () => {
    // The pre-fix `=== 'inbox'` test sent this RecordId past both branches into
    // the contact throw, so the message is the branch assertion.
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('personal_inbox', 'pi_1'))
    ).rejects.toThrow('Only inbox managers can change inbox access')
  })

  it('still routes a shared inbox the same way (control)', async () => {
    h.hasPermission.mockResolvedValue(true)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('inbox', 'i_1'))
    ).resolves.toBeUndefined()
    expect(askedAbout()).toBe('inbox:i_1')
  })

  it('still refuses a contact share for a non-admin (negative control)', async () => {
    h.hasPermission.mockResolvedValue(true)
    await expect(assertCanManageMailSharing(ctx(), toRecordId('contact', 'c_1'))).rejects.toThrow(
      'Only admins can share a contact’s conversations'
    )
  })
})

/**
 * Plan 40 §4.2 — the rank short-circuit is deleted for the INBOX branch only.
 * The ordering is the edit: the branch now sits ABOVE the `vis.isAdmin` read, so
 * moving it back below re-opens the bypass and the first two cases go green
 * again.
 */
describe('assertCanManageMailSharing — inboxes are managed through rows, not rank', () => {
  const asAdmin = () => h.getCachedUserInstanceGrants.mockResolvedValue({ isAdmin: true } as never)

  it('refuses an ADMIN who holds no Manager row on the inbox', async () => {
    asAdmin()
    h.hasPermission.mockResolvedValue(false)
    await expect(assertCanManageMailSharing(ctx(), toRecordId('inbox', 'i_1'))).rejects.toThrow(
      'Only inbox managers can change inbox access'
    )
    // It really consulted the rows rather than short-circuiting past them.
    expect(h.hasPermission).toHaveBeenCalledTimes(1)
    expect(askedAbout()).toBe('inbox:i_1')
  })

  it('refuses an ADMIN on a personal mailbox they do not manage', async () => {
    asAdmin()
    h.hasPermission.mockResolvedValue(false)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('personal_inbox', 'pi_1'))
    ).rejects.toThrow('Only inbox managers can change inbox access')
  })

  it('POSITIVE CONTROL: an inbox Manager who is NOT an admin still manages access', async () => {
    h.getCachedUserInstanceGrants.mockResolvedValue({ isAdmin: false } as never)
    h.hasPermission.mockResolvedValue(true)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('inbox', 'i_1'))
    ).resolves.toBeUndefined()
  })

  it('the thread branch KEEPS its rank short-circuit (plan 40 §2 scope)', async () => {
    asAdmin()
    h.hasPermission.mockResolvedValue(false)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('thread', 't_1'))
    ).resolves.toBeUndefined()
  })

  it('the contact branch KEEPS its rank short-circuit too', async () => {
    asAdmin()
    h.hasPermission.mockResolvedValue(false)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('contact', 'c_1'))
    ).resolves.toBeUndefined()
  })

  it('self-revoke still exits before either branch', async () => {
    h.getCachedUserInstanceGrants.mockResolvedValue({ isAdmin: false } as never)
    h.hasPermission.mockResolvedValue(false)
    await expect(
      assertCanManageMailSharing(ctx(), toRecordId('inbox', 'i_1'), {
        selfRevokeGranteeType: 'user',
        selfRevokeGranteeId: 'u_caller',
      })
    ).resolves.toBeUndefined()
    expect(h.hasPermission).not.toHaveBeenCalled()
  })
})

describe('assertCanManageMailSharing — thread re-share resolves the inbox’s def', () => {
  const shareThread = () => assertCanManageMailSharing(ctx(), toRecordId('thread', 't_1'))

  it('checks Manager on personal_inbox when the thread sits in a personal mailbox', async () => {
    h.rowsByTable = { Thread: [{ inboxId: 'pi_1' }] }
    h.cachedInboxes = [{ id: 'pi_1', entityDefinitionKey: 'personal_inbox' }]
    h.hasPermission.mockResolvedValue(true)
    await expect(shareThread()).resolves.toBeUndefined()
    expect(askedAbout()).toBe('personal_inbox:pi_1')
  })

  it('checks Manager on inbox when the thread sits in a shared inbox (control)', async () => {
    h.rowsByTable = { Thread: [{ inboxId: 'i_1' }] }
    h.cachedInboxes = [{ id: 'i_1', entityDefinitionKey: 'inbox' }]
    h.hasPermission.mockResolvedValue(true)
    await expect(shareThread()).resolves.toBeUndefined()
    expect(askedAbout()).toBe('inbox:i_1')
  })

  it('falls back to the inbox slug when the inbox is not in the cache', async () => {
    h.rowsByTable = { Thread: [{ inboxId: 'i_gone' }] }
    h.hasPermission.mockResolvedValue(true)
    await expect(shareThread()).resolves.toBeUndefined()
    expect(askedAbout()).toBe('inbox:i_gone')
  })

  it('denies a sub-full viewer before any inbox lookup happens', async () => {
    h.getThreadLens.mockResolvedValue('identity')
    h.rowsByTable = { Thread: [{ inboxId: 'pi_1' }] }
    await expect(shareThread()).rejects.toThrow(
      'Only admins or inbox managers can share this conversation'
    )
    expect(h.hasPermission).not.toHaveBeenCalled()
  })

  // `preloadedThread` is what keeps the access-request decision path from reading
  // one `Thread` row three times. If the guard ever goes back to loading it
  // itself, this select count is what says so.
  it('reads NO thread row when the caller preloads it', async () => {
    const selects = vi.fn()
    const preloadingCtx = {
      db: {
        select: () => {
          selects()
          return {
            from: () => ({
              where: () => Object.assign(Promise.resolve([]), { limit: async () => [] }),
            }),
          }
        },
      },
      organizationId: ORG,
      userId: 'u_caller',
    } as any
    h.cachedInboxes = [{ id: 'pi_1', entityDefinitionKey: 'personal_inbox' }]
    h.hasPermission.mockResolvedValue(true)

    await expect(
      assertCanManageMailSharing(preloadingCtx, toRecordId('thread', 't_1'), {
        preloadedThread: {
          threadId: 't_1',
          inboxId: 'pi_1',
          assigneeId: null,
          primaryEntityInstanceId: null,
        },
      })
    ).resolves.toBeUndefined()
    expect(selects).not.toHaveBeenCalled()
    expect(askedAbout()).toBe('personal_inbox:pi_1')
  })
})

describe('assertMailSharingFeature — the plan gate covers both inbox defs', () => {
  const newManager = [{ granteeId: 'u_new', rung: 'admin' }]

  it('gates a new Manager on a personal mailbox', async () => {
    await assertMailSharingFeature(ctx(), toRecordId('personal_inbox', 'pi_1'), newManager)
    expect(h.requireAccess).toHaveBeenCalled()
  })

  it('gates a new Manager on a shared inbox (control)', async () => {
    await assertMailSharingFeature(ctx(), toRecordId('inbox', 'i_1'), newManager)
    expect(h.requireAccess).toHaveBeenCalled()
  })

  it('leaves a re-submitted existing Manager ungated on a personal mailbox', async () => {
    existingManagerRows.push({ granteeId: 'u_new' })
    await assertMailSharingFeature(ctx(), toRecordId('personal_inbox', 'pi_1'), newManager)
    expect(h.requireAccess).not.toHaveBeenCalled()
  })

  it('does not apply the new-Manager gate to a thread share (negative control)', async () => {
    await assertMailSharingFeature(ctx(), toRecordId('thread', 't_1') as RecordId, newManager)
    expect(h.requireAccess).not.toHaveBeenCalled()
  })

  it('still gates any sub-full lens on a personal mailbox', async () => {
    await assertMailSharingFeature(ctx(), toRecordId('personal_inbox', 'pi_1'), [
      { granteeId: 'u_new', rung: 'metadata' },
    ])
    expect(h.requireAccess).toHaveBeenCalled()
  })

  /**
   * Plan v3/03 §7.6 (D9): `FeatureKey.mailPermissions` is DELETED and mail sharing
   * rides `granularPermissions`, so one key gates the whole permission layer and
   * record sharing inherits it with no new plumbing. Asserting the KEY, not just
   * "the gate ran" — pointing this at a key no plan seeds would deny every share
   * on every plan, and pointing it at a retired key would allow every share on
   * every plan. Both failures look identical to a `toHaveBeenCalled()` test.
   */
  it('asks for granularPermissions — the ONE permission-layer key (§7.6)', async () => {
    await assertMailSharingFeature(ctx(), toRecordId('inbox', 'i_1'), newManager)
    expect(h.requireAccess).toHaveBeenCalledWith('org_1', FeatureKey.granularPermissions)
    expect(FeatureKey).not.toHaveProperty('mailPermissions')
  })
})
