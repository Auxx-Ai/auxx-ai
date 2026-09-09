// apps/web/src/server/api/routers/member-shares-permissions.test.ts

/**
 * Plan 46 §9's "Router" tests — the Shared tab's gate is a PAIR (§4.2), and each
 * half alone must refuse.
 *
 * `members.manage` alone is not enough: the rank guard is what stops an ADMIN
 * from stripping an OWNER's shares, or one ADMIN from stripping a peer's. The
 * rank guard alone is not enough either — a member with no `members.manage` key
 * never reaches the resolver.
 *
 * The third case is the asymmetric one: viewing your OWN Shared tab is allowed
 * and read-only. `canManageTarget` refuses self outright, so a naive "run the
 * same guard for reads and writes" would make the tab 403 for the person it is
 * describing; and a naive "skip the guard for self" would let anyone strip their
 * own rows through a bulk endpoint that has no self-revoke exception (that hatch
 * lives on `resourceAccess.revokeInstance`, per-resource, and is mail-aware).
 *
 * Modelled on `calls-tasks-permissions.test.ts`: a real `CapabilitySet` driven
 * through `router.createCaller`, asserting the `ForbiddenError` shape
 * `auxxErrorMiddleware` maps to a 403.
 */

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'
const OWNER_ID = 'usr_owner00000000000000000000'
const ADMIN_ID = 'usr_admin00000000000000000000'
const PEER_ADMIN_ID = 'usr_admin20000000000000000000'
const MEMBER_ID = 'usr_member0000000000000000000'

const okResult = <T>(value: T) => ({
  isErr: () => false as const,
  isOk: () => true as const,
  value,
})

const { memberShares, audit, cachedMembers } = vi.hoisted(() => ({
  memberShares: {
    getMemberShareSummary: vi.fn(),
    listMemberShares: vi.fn(),
    listMemberTypeGrants: vi.fn(),
    revokeMemberShares: vi.fn(),
  },
  audit: { recordAuditFromCtx: vi.fn(async () => undefined) },
  cachedMembers: { current: [] as Array<{ userId: string; role: string }> },
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedMembers: async () => cachedMembers.current,
  getCachedResources: async () => [],
  onCacheEvent: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/dehydration', () => ({ DehydrationService: class {} }))

vi.mock('@auxx/lib/members', () => ({
  acceptInvitation: vi.fn(),
  acceptInvitationById: vi.fn(),
  assignMemberProfile: vi.fn(),
  // NOT a `vi.fn()`. Half the cases below assert the rank ladder itself
  // (ADMIN cannot act on an ADMIN peer, only OWNER acts on OWNER), so a stub
  // would let the router's gate pass while testing nothing. This is the real
  // rule from `@auxx/lib/members` guards; the router no longer keeps its own
  // copy of it.
  canManageTarget: (actorRole: string, targetRole: string) => {
    if (actorRole === 'OWNER') return true
    if (targetRole === 'OWNER') return false
    if (actorRole === 'ADMIN' && targetRole === 'ADMIN') return false
    const rank: Record<string, number> = { OWNER: 3, ADMIN: 2, USER: 1 }
    return (rank[targetRole] ?? 0) <= (rank[actorRole] ?? 0)
  },
  cancelInvitation: vi.fn(),
  findMemberByUser: vi.fn(),
  getActiveMemberCount: vi.fn(),
  getInvitationLink: vi.fn(),
  getInvitationPreview: vi.fn(),
  getMyPendingInvitations: vi.fn(),
  getPendingInvitations: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  resendInvitation: vi.fn(),
  updateMemberSeatType: vi.fn(),
}))

vi.mock('@auxx/lib/resource-access', () => ({
  MAX_REVOKE_RECORD_IDS: 500,
  MEMBER_SHARES_PAGE_SIZE: 50,
  MEMBER_SHARES_SEARCH_SCAN_CAP: 500,
  MEMBER_SHARE_GROUPS: new Proxy(
    {},
    { get: () => ({ label: 'Conversations', noun: 'conversation' }) }
  ),
  groupKeyForDef: () => 'thread',
  ...memberShares,
}))

vi.mock('~/server/api/audit-context', () => audit)

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    publicProcedure: t.procedure,
    notDemo:
      () =>
      ({ ctx, next }: { ctx: unknown; next: () => unknown }) =>
        next(),
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (permission: string) => void } }).capabilities.assert(
          key
        )
        return next()
      }),
    isAuxxError: (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in (error as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { memberRouter } = await import('./member')

type Capabilities = InstanceType<typeof CapabilitySet>

function capabilitiesFor(levels: Partial<Record<Area, Level>>): Capabilities {
  return new CapabilitySet(new Set(expandLevelsToKeys(levels)), {}, 'MEMBER', 'full')
}

const noKeys = () => capabilitiesFor({})
const membersManage = () => capabilitiesFor({ [Area.members]: Level.Full })

function caller(userId: string, capabilities: Capabilities) {
  return memberRouter.createCaller({
    capabilities,
    db: { marker: 'member-shares-db' },
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId,
      user: { id: userId, defaultOrganizationId: ORG_ID, isAdmin: false },
      isSuperAdmin: false,
    },
  } as never)
}

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

beforeEach(() => {
  vi.clearAllMocks()
  cachedMembers.current = [
    { userId: OWNER_ID, role: 'OWNER' },
    { userId: ADMIN_ID, role: 'ADMIN' },
    { userId: PEER_ADMIN_ID, role: 'ADMIN' },
    { userId: MEMBER_ID, role: 'USER' },
  ]
  memberShares.getMemberShareSummary.mockResolvedValue(okResult({ groups: [], owned: [] }))
  memberShares.listMemberTypeGrants.mockResolvedValue(okResult([]))
  memberShares.listMemberShares.mockResolvedValue(
    okResult({ items: [], nextCursor: null, total: 0 })
  )
  memberShares.revokeMemberShares.mockResolvedValue(
    okResult({ revoked: 3, refused: [], refusedIds: [] })
  )
})

describe('member.shareSummary', () => {
  it('refuses a caller without members.manage, whatever their rank', async () => {
    await expect(
      caller(ADMIN_ID, noKeys()).shareSummary({ memberId: MEMBER_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(memberShares.getMemberShareSummary).not.toHaveBeenCalled()
  })

  it('refuses members.manage that cannot act on the target', async () => {
    // ADMIN → OWNER, and ADMIN → ADMIN peer: both refused by `canManageTarget`.
    await expect(
      caller(ADMIN_ID, membersManage()).shareSummary({ memberId: OWNER_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller(ADMIN_ID, membersManage()).shareSummary({ memberId: PEER_ADMIN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(memberShares.getMemberShareSummary).not.toHaveBeenCalled()
  })

  it('admits members.manage over a lower-ranked member', async () => {
    await expect(
      caller(ADMIN_ID, membersManage()).shareSummary({ memberId: MEMBER_ID })
    ).resolves.toBeDefined()
  })

  it('admits a member reading their OWN tab even though the rank guard refuses self', async () => {
    await expect(
      caller(MEMBER_ID, membersManage()).shareSummary({ memberId: MEMBER_ID })
    ).resolves.toBeDefined()
    await expect(
      caller(MEMBER_ID, membersManage()).shares({
        memberId: MEMBER_ID,
        entityDefinitionId: 'thread',
      })
    ).resolves.toBeDefined()
  })
})

describe('member.revokeShares', () => {
  it('refuses self — the own tab is read-only', async () => {
    await expect(
      caller(MEMBER_ID, membersManage()).revokeShares({
        memberId: MEMBER_ID,
        scope: { kind: 'all' },
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(memberShares.revokeMemberShares).not.toHaveBeenCalled()
  })

  it('refuses a caller without members.manage', async () => {
    await expect(
      caller(ADMIN_ID, noKeys()).revokeShares({ memberId: MEMBER_ID, scope: { kind: 'all' } })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('writes exactly one security audit row per call, whatever the scope covers', async () => {
    const result = await caller(ADMIN_ID, membersManage()).revokeShares({
      memberId: MEMBER_ID,
      scope: { kind: 'all' },
    })

    expect(result).toMatchObject({ revoked: 3 })
    expect(audit.recordAuditFromCtx).toHaveBeenCalledTimes(1)
    expect(audit.recordAuditFromCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        category: 'security',
        action: 'permission.revoked',
        targetType: 'OrganizationMember',
        targetId: MEMBER_ID,
        metadata: expect.objectContaining({
          scope: 'all',
          granteeType: 'user',
          granteeId: MEMBER_ID,
          revoked: 3,
        }),
      })
    )
  })
})
