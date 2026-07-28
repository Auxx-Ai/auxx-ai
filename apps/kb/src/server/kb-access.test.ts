// apps/kb/src/server/kb-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * apps/kb's per-instance gate. Two layers, deliberately split:
 *
 * - **Predicate tests** drive `canViewKB` against a REAL `CapabilitySet` with a
 *   stubbed `getCapabilities`. Pure composition — no database mock at all.
 * - **Wiring tests** drive `loadKBPayload` to pin the ORDER of the checks
 *   (public short-circuit, unauthenticated short-circuit, DRAFT outranks
 *   access) and — critically — that the chokepoint actually calls the
 *   predicate. Without that last one, reverting the gate to `isOrgMember`
 *   would leave the predicate tests green and prove nothing.
 *
 * `isOrgMember` is stubbed to `true` throughout so a regression back to it
 * fails loudly rather than accidentally denying.
 */

const { getCapabilities, isOrgMember, redirect, dbRows, select } = vi.hoisted(() => {
  const dbRows = {
    kb: [] as Record<string, unknown>[],
    placements: [] as Record<string, unknown>[],
  }

  // Drizzle's builder is thenable and the two selects in `kb-data.ts` have
  // different shapes; branch on the projection keys rather than call order.
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {}
    q.from = () => q
    q.innerJoin = () => q
    q.where = () => q
    q.orderBy = () => q
    q.limit = () => Promise.resolve(rows)
    // `kb-data.ts` awaits one query without `.limit()`, so the stub must be thenable too.
    // biome-ignore lint/suspicious/noThenProperty: mirroring drizzle's own thenable builder
    q.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err)
    return q
  }

  return {
    getCapabilities: vi.fn(),
    isOrgMember: vi.fn(async () => true),
    redirect: vi.fn(),
    dbRows,
    select: vi.fn((fields: Record<string, unknown>) =>
      chain('kb' in fields ? dbRows.kb : dbRows.placements)
    ),
  }
})

vi.mock('@auxx/lib/permissions/capabilities/get-capabilities', () => ({ getCapabilities }))
vi.mock('@auxx/lib/cache', () => ({ isOrgMember }))
vi.mock('@auxx/config/urls', () => ({ WEBAPP_URL: 'https://app.test' }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@auxx/lib/files/server', () => ({
  MediaAssetService: class {
    getDownloadUrl = async () => null
  },
}))
vi.mock('@auxx/database', () => ({
  database: { select },
  Article: {},
  ArticlePlacement: {},
  ArticleRevision: {},
  KnowledgeBase: {},
  Organization: {},
}))
vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn(), isNull: vi.fn() }))
vi.mock('drizzle-orm/pg-core', () => ({ alias: (table: unknown) => table }))

// Deep paths on purpose — the `@auxx/lib/permissions` barrel hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { Area, expandLevelsToKeys, Level } = await import(
  '@auxx/lib/permissions/capabilities/registry'
)
const { canViewKB } = await import('./kb-access')
const { loadKBPayload } = await import('./kb-data')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const KB_ID = 'kb_cuid00000000000000000000'

/** A real {@link CapabilitySet} — the composition under test, never a stub. */
function capabilitiesFor({
  role = 'MEMBER' as OrganizationRole,
  area = Level.Read,
  instances = {} as Record<string, ResourcePermission>,
} = {}) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.knowledgeBase]: area })),
    {},
    role,
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances))
  )
}

function givenCapabilities(caps: InstanceType<typeof CapabilitySet>) {
  getCapabilities.mockResolvedValue(caps)
}

function kbRow(overrides: Record<string, unknown> = {}) {
  return {
    kb: {
      id: KB_ID,
      organizationId: ORG_ID,
      name: 'HR Policies',
      slug: 'hr-policies',
      description: null,
      publishStatus: 'PUBLISHED',
      visibility: 'INTERNAL',
      defaultMode: null,
      ...overrides,
    },
    orgId: ORG_ID,
  }
}

const PLACEMENT = {
  placementId: 'plc_1',
  articleId: 'art_1',
  knowledgeBaseId: KB_ID,
  slug: 'leave-policy',
  parentPlacementId: null,
  articleKind: 'standard',
  sortOrder: 'a0',
  isPublished: true,
  title: 'Leave policy',
  emoji: null,
  description: null,
  excerpt: null,
}

beforeEach(() => {
  getCapabilities.mockReset()
  isOrgMember.mockReset()
  isOrgMember.mockResolvedValue(true)
  redirect.mockReset()
  select.mockClear()
  dbRows.kb = [kbRow()]
  dbRows.placements = [PLACEMENT]
})

describe('canViewKB — composition', () => {
  it('resolves capabilities for (userId, orgId), in that order', async () => {
    givenCapabilities(capabilitiesFor())
    await canViewKB(KB_ID, ORG_ID, USER_ID)
    expect(getCapabilities).toHaveBeenCalledWith(USER_ID, ORG_ID)
  })

  it('allows a member with no explicit row and knowledgeBase: Read', async () => {
    givenCapabilities(capabilitiesFor({ area: Level.Read }))
    await expect(canViewKB(KB_ID, ORG_ID, USER_ID)).resolves.toBe(true)
  })

  it('denies a member with an explicit permission: none row on this KB', async () => {
    givenCapabilities(
      capabilitiesFor({ area: Level.Full, instances: { [KB_ID]: ResourcePermission.none } })
    )
    await expect(canViewKB(KB_ID, ORG_ID, USER_ID)).resolves.toBe(false)
  })

  it('denies a member composing knowledgeBase: None with no instance row', async () => {
    givenCapabilities(capabilitiesFor({ area: Level.None }))
    await expect(canViewKB(KB_ID, ORG_ID, USER_ID)).resolves.toBe(false)
  })

  it('denies a non-member (the regression guard for the isOrgMember swap)', async () => {
    // What `getCapabilities` composes for a user with no memberRoleMap entry.
    givenCapabilities(capabilitiesFor({ role: 'USER', area: Level.None }))
    await expect(canViewKB(KB_ID, ORG_ID, USER_ID)).resolves.toBe(false)
  })

  it('allows OWNER regardless of area level or explicit row', async () => {
    givenCapabilities(
      capabilitiesFor({
        role: 'OWNER',
        area: Level.None,
        instances: { [KB_ID]: ResourcePermission.none },
      })
    )
    await expect(canViewKB(KB_ID, ORG_ID, USER_ID)).resolves.toBe(true)
  })

  it('lets an explicit view grant beat a knowledgeBase: None area floor', async () => {
    givenCapabilities(
      capabilitiesFor({ area: Level.None, instances: { [KB_ID]: ResourcePermission.view } })
    )
    await expect(canViewKB(KB_ID, ORG_ID, USER_ID)).resolves.toBe(true)
  })

  it('scopes the grant to the KB it was written for', async () => {
    givenCapabilities(
      capabilitiesFor({ area: Level.None, instances: { [KB_ID]: ResourcePermission.view } })
    )
    await expect(canViewKB('kb_other', ORG_ID, USER_ID)).resolves.toBe(false)
  })
})

describe('loadKBPayload — gate wiring', () => {
  it('serves a PUBLIC KB with no session and never resolves capabilities', async () => {
    dbRows.kb = [kbRow({ visibility: 'PUBLIC' })]

    const { kb, articles, accessDenied } = await loadKBPayload('acme', 'hr-policies')

    expect(kb?.id).toBe(KB_ID)
    expect(articles).toHaveLength(1)
    expect(accessDenied).toBeUndefined()
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('short-circuits an anonymous caller on an INTERNAL KB before the gate', async () => {
    const { kb, articles, accessDenied } = await loadKBPayload('acme', 'hr-policies')

    expect(kb).toBeNull()
    expect(articles).toEqual([])
    expect(accessDenied).toBe('unauthenticated')
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('runs the per-instance gate for a session on an INTERNAL KB', async () => {
    givenCapabilities(
      capabilitiesFor({ area: Level.Full, instances: { [KB_ID]: ResourcePermission.none } })
    )

    const { kb, articles, accessDenied } = await loadKBPayload('acme', 'hr-policies', {
      session: { userId: USER_ID },
    })

    // The wiring assertion: without this, reverting the chokepoint to
    // `isOrgMember` leaves every predicate test above green.
    expect(getCapabilities).toHaveBeenCalledWith(USER_ID, ORG_ID)
    expect(kb).toBeNull()
    expect(articles).toEqual([])
    expect(accessDenied).toBe('forbidden')
  })

  it('serves an INTERNAL KB to a member the gate admits', async () => {
    givenCapabilities(capabilitiesFor({ area: Level.Read }))

    const { kb, articles, accessDenied } = await loadKBPayload('acme', 'hr-policies', {
      session: { userId: USER_ID },
    })

    expect(kb?.id).toBe(KB_ID)
    expect(articles).toHaveLength(1)
    expect(accessDenied).toBeUndefined()
  })

  it('lets DRAFT lifecycle outrank access for a fully-privileged session', async () => {
    dbRows.kb = [kbRow({ publishStatus: 'DRAFT' })]
    givenCapabilities(capabilitiesFor({ role: 'OWNER', area: Level.Full }))

    const { kb, articles, accessDenied } = await loadKBPayload('acme', 'hr-policies', {
      session: { userId: USER_ID },
    })

    expect(kb).toBeNull()
    expect(articles).toEqual([])
    expect(accessDenied).toBeUndefined()
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})
