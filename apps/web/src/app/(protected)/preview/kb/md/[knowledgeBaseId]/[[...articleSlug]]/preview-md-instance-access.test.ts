// apps/web/src/app/(protected)/preview/kb/md/[knowledgeBaseId]/[[...articleSlug]]/preview-md-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The `.md` preview route — the widest article read in the product (plan v3/06
 * §3.3 X6).
 *
 * Its ONLY authorization was "there is a session and it carries a
 * `defaultOrganizationId`". It then ran `getArticles(kbId, { includeUnpublished:
 * true })` and returned the article's full DRAFT Markdown body, for ANY KB id in
 * the org — hidden `source` KBs, AI Memory, unpublished drafts. The tRPC sibling
 * `kb.getArticles` runs `assertViewInstance('kb', kbId)`.
 *
 * ⚠ Route handlers get no `auxxErrorMiddleware`, so these pin the **status
 * code**: an `AuxxError` escaping here would be a 500, not a 403.
 *
 * Behavioral: the handler runs with a REAL `CapabilitySet`, and `KBService`
 * reads are the observed side effect — the gate must land ahead of them.
 */

const {
  getCapabilities,
  getSession,
  getArticles,
  getArticleById,
  findArticleBySlugPath,
  findFirstNavigableUnder,
} = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  getArticles: vi.fn(),
  getArticleById: vi.fn(),
  findArticleBySlugPath: vi.fn(),
  findFirstNavigableUnder: vi.fn(),
}))

vi.mock('@auxx/database', async () => (await import('~/test/database-mock')).mockAuxxDatabase())

vi.mock('@auxx/lib/kb', () => ({
  KBService: class {
    getArticles = getArticles
    getArticleById = getArticleById
  },
  articleToMarkdown: () => 'body text',
}))

// The `@auxx/lib/permissions` barrel HANGS under vitest — stub it, keep the
// enums real via `/client` (see `kb-article-instance-access.test.ts`).
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

vi.mock('@auxx/ui/components/kb', () => ({
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getFullSlugPath: () => 'some/path',
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const KB_ID = 'kb_cuid0000000000000000000000'
const ARTICLE_ID = 'art_cuid000000000000000000000'

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

function signedIn(capabilities: InstanceType<typeof CapabilitySet>) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const request = () => new Request('https://app.auxx.ai/preview/kb/md/kb_x/getting-started')
const params = {
  params: Promise.resolve({ knowledgeBaseId: KB_ID, articleSlug: ['getting-started'] }),
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  getArticles.mockReset().mockResolvedValue([{ id: ARTICLE_ID, articleKind: 'page' }])
  getArticleById
    .mockReset()
    .mockResolvedValue({ title: 'Secret runbook', contentJson: [{ type: 'paragraph' }] })
  findArticleBySlugPath.mockReset().mockReturnValue({ id: ARTICLE_ID, articleKind: 'page' })
  findFirstNavigableUnder.mockReset().mockReturnValue({ id: ARTICLE_ID, articleKind: 'page' })
})

describe('GET /preview/kb/md/[knowledgeBaseId] — the draft-body hole', () => {
  it('401s without a session, before any capability or KB read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(getArticles).not.toHaveBeenCalled()
  })

  it('403s a session with no organization, before any capability or KB read', async () => {
    getSession.mockResolvedValue({ user: { id: USER_ID, isSuperAdmin: false } })
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(getArticles).not.toHaveBeenCalled()
  })

  it('403s — not 500 — a member composing `knowledgeBase: None`', async () => {
    signedIn(areaOnly(Level.None))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // The gate must precede the read: `getArticles` is what fetches the draft.
    expect(getArticles).not.toHaveBeenCalled()
    expect(getArticleById).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on the KB', async () => {
    // THE case this fix exists for: the area is wide open (Full) and only the
    // per-instance `none` row stands between the caller and the draft body.
    signedIn(capabilitiesFor(ResourcePermission.none, Level.Full))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(getArticles).not.toHaveBeenCalled()
  })

  it('never emits the draft markdown on the denied path', async () => {
    signedIn(capabilitiesFor(ResourcePermission.none, Level.Full))
    const res = await GET(request(), params)
    const text = await res.text()
    expect(text).not.toContain('Secret runbook')
    expect(text).not.toContain('body text')
    expect(res.headers.get('content-type')).not.toContain('text/markdown')
  })

  it('200s with the markdown for a member holding instance `view` on the KB', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await res.text()).toBe('# Secret runbook\n\nbody text')
  })

  it('200s for a row-less KB at the area Read rung (baselineAtCreate: false)', async () => {
    signedIn(areaOnly(Level.Read))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
  })

  it('gates on the requested KB, not the area, when only an instance row grants it', async () => {
    // Area None, and the ONLY grant is an explicit `view` row on the KB.
    signedIn(capabilitiesFor(ResourcePermission.view, Level.None))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
  })

  it('403s a KB the member holds no row on while holding another at admin', async () => {
    // The URL's KB id is caller-supplied — holding one KB must not open a second.
    signedIn(capabilitiesFor(ResourcePermission.admin, Level.None))
    const res = await GET(request(), {
      params: Promise.resolve({ knowledgeBaseId: 'kb_otheruid00000000000000000' }),
    })
    expect(res.status).toBe(403)
    expect(getArticles).not.toHaveBeenCalled()
  })
})
