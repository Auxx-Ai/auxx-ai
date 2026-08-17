// apps/web/src/app/(protected)/preview/kb/[knowledgeBaseId]/r/[articleId]/preview-redirect-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The stable-id redirect behind `auxx://kb/article/{id}` links (plan v3/06 §3.3
 * X7). Three separate holes, all in one handler:
 *
 * 1. The `ArticlePlacement` query carried **no `organizationId` filter**, so it
 *    resolved placements from any org.
 * 2. The org guard was `if (userOrgId && userOrgId !== row.organizationId)` —
 *    the `userOrgId &&` short-circuit meant a session with no
 *    `defaultOrganizationId` passed it entirely. That made the route
 *    cross-**org**, not merely cross-KB.
 * 3. There was no KB instance gate at all. It only 308s, so it discloses the
 *    target's slug path rather than the body — still a read of a KB the member
 *    may be explicitly denied.
 *
 * The gate keys on the **resolved target** KB (`row.knowledgeBaseId`), not the
 * URL's: a cross-KB internal link redirects to a different KB than it names.
 *
 * ⚠ Route handlers get no `auxxErrorMiddleware`, so these pin the **status
 * code**.
 */

const { getCapabilities, getSession, select, where, eq, and } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
}))

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: { select },
    ArticlePlacement: {
      id: 'ArticlePlacement.id',
      slug: 'ArticlePlacement.slug',
      parentId: 'ArticlePlacement.parentId',
      articleId: 'ArticlePlacement.articleId',
      knowledgeBaseId: 'ArticlePlacement.knowledgeBaseId',
      organizationId: 'ArticlePlacement.organizationId',
    },
  })
)

vi.mock('drizzle-orm', () => ({ and, eq }))

// The `@auxx/lib/permissions` barrel HANGS under vitest — stub it, keep the
// enums real via `/client` (see `kb-article-instance-access.test.ts`).
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const OTHER_ORG_ID = 'org_otheruid0000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const KB_ID = 'kb_cuid0000000000000000000000'
const ARTICLE_ID = 'art_cuid000000000000000000000'
const PLACEMENT_ID = 'plc_cuid000000000000000000000'

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** A real `CapabilitySet` holding `permission` on {@link KB_ID} via an explicit row. */
function capabilitiesFor(permission: ResourcePermission, areaLevel = AREA_LEVEL_OF[permission]) {
  const instances = { [KB_ID]: permissionToRung(permission) }
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.knowledgeBase]: areaLevel })),
    {},
    'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances))
  )
}

/** A real `CapabilitySet` with no instance rows at all — pure area level. */
function areaOnly(level: Level) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.knowledgeBase]: level })),
    {},
    'MEMBER',
    'full'
  )
}

function signedIn(capabilities: InstanceType<typeof CapabilitySet>, orgId: string | null = ORG_ID) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: orgId, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const request = () =>
  ({
    url: `https://app.auxx.ai/preview/kb/${KB_ID}/r/${ARTICLE_ID}`,
    nextUrl: { pathname: `/preview/kb/${KB_ID}/r/${ARTICLE_ID}` },
  }) as never

const ctx = { params: Promise.resolve({ knowledgeBaseId: KB_ID, articleId: ARTICLE_ID }) }

/** Placement rows returned by the first `select`; the slug walk gets the second. */
function placements(rows: Array<Record<string, unknown>>) {
  where
    .mockResolvedValueOnce(rows)
    .mockResolvedValue([{ id: PLACEMENT_ID, slug: 'getting-started', parentId: null }])
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  eq.mockClear()
  and.mockClear()
  where.mockReset()
  select.mockReset().mockReturnValue({ from: () => ({ where }) })
})

describe('GET /preview/kb/[kbId]/r/[articleId] — org scope + KB gate', () => {
  it('redirects to login without a session, before any read', async () => {
    getSession.mockResolvedValue(null)
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: KB_ID, organizationId: ORG_ID }])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(307)
    expect(select).not.toHaveBeenCalled()
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('403s a session with no organization instead of resolving the article', async () => {
    // The old guard was `userOrgId && userOrgId !== row.organizationId`, so an
    // org-less session skipped it and got another org's slug path.
    signedIn(capabilitiesFor(ResourcePermission.admin), null)
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: KB_ID, organizationId: OTHER_ORG_ID }])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
  })

  it('scopes the placement read by organization', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: KB_ID, organizationId: ORG_ID }])
    await GET(request(), ctx)
    expect(eq).toHaveBeenCalledWith('ArticlePlacement.organizationId', ORG_ID)
  })

  it('403s — not 500 — a member composing `knowledgeBase: None`', async () => {
    signedIn(areaOnly(Level.None))
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: KB_ID, organizationId: ORG_ID }])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
  })

  it('403s a member holding an explicit `none` restriction on the KB', async () => {
    signedIn(capabilitiesFor(ResourcePermission.none, Level.Full))
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: KB_ID, organizationId: ORG_ID }])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(403)
  })

  it('308s to the slug path for a member holding instance `view`', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: KB_ID, organizationId: ORG_ID }])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(
      `https://app.auxx.ai/preview/kb/${KB_ID}/getting-started`
    )
  })

  it('gates the RESOLVED target KB, not the URL segment', async () => {
    // The link names KB_ID but the only placement lives in a KB the member is
    // denied — asserting on the URL segment would wave this through.
    const TARGET_KB = 'kb_targetuid00000000000000000'
    signedIn(capabilitiesFor(ResourcePermission.admin, Level.None))
    placements([{ id: PLACEMENT_ID, knowledgeBaseId: TARGET_KB, organizationId: ORG_ID }])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(403)
  })

  it('404s when the article has no placement in the caller org', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    placements([])
    const res = await GET(request(), ctx)
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})
