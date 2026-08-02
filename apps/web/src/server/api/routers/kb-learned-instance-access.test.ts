// apps/web/src/server/api/routers/kb-learned-instance-access.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `kb.learnedArticleDiff` / `kb.learnedProvenance` (plan v3/06 §3.2 K5).
 *
 * Both gated on `assert(PermissionKey.knowledgeBaseView)` alone — an AREA check
 * with no instance check — and neither was restricted to the learned KB. Since
 * `articleId` is caller-supplied, `learnedArticleDiff({ articleId, markdown:
 * '' })` renders the target article's ENTIRE published body as removed diff
 * lines: a full-content read of any article in the org for anyone at
 * `knowledgeBase: Read`. `learnedProvenance` additionally returned `Thread`
 * subject lines with no mail lens.
 *
 * The fix keeps the area assert and ADDS `assertViewInstance('kb', homeKbId)`,
 * matching every other article read in this router. The mail clamp is separate:
 * a subject is `identity`-tier (`permissions/visibility/lens.ts`), so KB access
 * alone must not surface it.
 */

const {
  getLearnedArticleDiff,
  getLearnedProvenance,
  getThreadLensBatch,
  getCachedUserInstanceGrants,
  getUserOrganizationId,
  articleLimit,
  select,
  eq,
  and,
} = vi.hoisted(() => ({
  getLearnedArticleDiff: vi.fn(async () => ({
    found: true,
    currentTitle: 'Refund policy',
    lines: [{ kind: 'removed', text: 'We refund within 30 days.' }],
    addedCount: 0,
    removedCount: 1,
  })),
  getLearnedProvenance: vi.fn(),
  getThreadLensBatch: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(async () => ({ grants: {}, defEntityTypes: {} })),
  getUserOrganizationId: vi.fn(() => 'org_cuid000000000000000000000'),
  articleLimit: vi.fn(),
  select: vi.fn(),
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
}))

vi.mock('@auxx/database', () => ({
  schema: {
    Article: {
      id: 'Article.id',
      organizationId: 'Article.organizationId',
      homeKnowledgeBaseId: 'Article.homeKnowledgeBaseId',
    },
    ArticleRevision: { id: 'ArticleRevision.id', articleId: 'ArticleRevision.articleId' },
    KnowledgeBase: { id: 'KnowledgeBase.id', organizationId: 'KnowledgeBase.organizationId' },
  },
}))

vi.mock('drizzle-orm', () => ({ and, eq, count: vi.fn(() => 'count') }))

vi.mock('@auxx/lib/kb', () => ({
  KBService: class {
    getArticleSlugPath = vi.fn(async () => 'some/path')
  },
  getLearnedArticleDiff,
  getLearnedProvenance,
  ensureLearnedKb: vi.fn(async () => ({ kb: { id: 'kb_learned' } })),
  articleToMarkdown: vi.fn(() => ''),
  linkArticlesIntoKb: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/cache', () => ({
  onCacheEvent: vi.fn(async () => undefined),
  getCachedUserInstanceGrants,
}))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId }))
vi.mock('@auxx/lib/permissions/visibility', () => ({ getThreadLensBatch }))
vi.mock('~/server/lib/kb-revalidate', () => ({ fireKBRevalidate: vi.fn(() => Promise.resolve()) }))

// The permissions barrel hangs under vitest — hand back the real enums and the
// real rung comparator, plus a stub feature service.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const types = await import('@auxx/lib/permissions/types')
  const rung = await import('@auxx/lib/permissions/capabilities/rung')
  return {
    PermissionKey: registry.PermissionKey,
    FeatureKey: types.FeatureKey,
    satisfiesRung: rung.satisfiesRung,
    FeaturePermissionService: class {
      requireAccess = vi.fn(async () => undefined)
      requireAccessAndLimit = vi.fn(async () => undefined)
    },
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

// Deep path on purpose — see the note above.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { knowledgeBaseRouter } = await import('./kb')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
/** The article's home KB — the gate's subject. */
const KB_ID = 'kb_cuid0000000000000000000000'
const ARTICLE_ID = 'art_cuid000000000000000000000'
const THREAD_ID = 'thr_cuid000000000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** A real `CapabilitySet` holding `permission` on {@link KB_ID} via an explicit row. */
function capabilitiesFor(
  permission: ResourcePermission,
  areaLevel: Level = {
    none: Level.None,
    read: Level.Read,
    edit: Level.Edit,
    admin: Level.Full,
  }[permission]
) {
  const instances = { [KB_ID]: permission }
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

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return knowledgeBaseRouter.createCaller({
    db: { select },
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never)
}

beforeEach(() => {
  getLearnedArticleDiff.mockClear()
  getLearnedProvenance.mockReset().mockResolvedValue([
    {
      threadId: THREAD_ID,
      subject: 'Refund for order #1042',
      extractedAt: '2026-07-01T00:00:00Z',
    },
  ])
  getThreadLensBatch.mockReset().mockResolvedValue(new Map([[THREAD_ID, 'read']]))
  getCachedUserInstanceGrants.mockClear()
  eq.mockClear()
  and.mockClear()
  articleLimit.mockReset().mockResolvedValue([{ knowledgeBaseId: KB_ID }])
  select.mockReset().mockReturnValue({ from: () => ({ where: () => ({ limit: articleLimit }) }) })
})

describe('kb.learnedArticleDiff — the full-body disclosure', () => {
  it('403s a member composing `knowledgeBase: None` on the area assert alone', async () => {
    await expect(
      caller(areaOnly(Level.None)).learnedArticleDiff({ articleId: ARTICLE_ID, markdown: 'x' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getLearnedArticleDiff).not.toHaveBeenCalled()
  })

  it('403s `markdown: ""` for a KB the member holds an explicit `none` on', async () => {
    // THE case. The area is wide open (Full) — only the per-instance `none` row
    // stands between the caller and every published line of the article, which
    // an empty proposal renders as removed diff lines.
    await expect(
      caller(capabilitiesFor('none', Level.Full)).learnedArticleDiff({
        articleId: ARTICLE_ID,
        markdown: '',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getLearnedArticleDiff).not.toHaveBeenCalled()
  })

  it('403s an area-Read member with no row on the article home KB', async () => {
    // The pre-fix bar: `knowledgeBase: Read` and nothing else. `kb` is
    // `baselineAtCreate: false`, so an area-None member with no row composes
    // `undefined` — this member holds Read on the area but the KB carries a
    // restricting row for someone else, i.e. the restricted set is non-empty.
    await expect(
      caller(capabilitiesFor('none', Level.Read)).learnedArticleDiff({
        articleId: ARTICLE_ID,
        markdown: '',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getLearnedArticleDiff).not.toHaveBeenCalled()
  })

  it('resolves the gate subject from the article home KB, org-scoped', async () => {
    await caller(capabilitiesFor('read')).learnedArticleDiff({
      articleId: ARTICLE_ID,
      markdown: 'x',
    })
    expect(eq).toHaveBeenCalledWith('Article.id', ARTICLE_ID)
    expect(eq).toHaveBeenCalledWith('Article.organizationId', ORG_ID)
  })

  it('200s for a member holding instance `read` on the home KB', async () => {
    await expect(
      caller(capabilitiesFor('read')).learnedArticleDiff({ articleId: ARTICLE_ID, markdown: '' })
    ).resolves.toMatchObject({ found: true })
    expect(getLearnedArticleDiff).toHaveBeenCalledTimes(1)
  })

  it('200s for a row-less KB at the area Read rung (baselineAtCreate: false)', async () => {
    await expect(
      caller(areaOnly(Level.Read)).learnedArticleDiff({ articleId: ARTICLE_ID, markdown: 'x' })
    ).resolves.toBeDefined()
  })

  it('404s an article outside the caller org before the instance gate', async () => {
    articleLimit.mockResolvedValue([])
    await expect(
      caller(capabilitiesFor('admin')).learnedArticleDiff({ articleId: ARTICLE_ID, markdown: '' })
    ).rejects.toMatchObject({ cause: { name: 'NotFoundError', statusCode: 404 } })
    expect(getLearnedArticleDiff).not.toHaveBeenCalled()
  })
})

describe('kb.learnedProvenance — KB gate plus the mail clamp', () => {
  it('403s a member composing `knowledgeBase: None`', async () => {
    await expect(
      caller(areaOnly(Level.None)).learnedProvenance({ articleId: ARTICLE_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getLearnedProvenance).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on the home KB', async () => {
    await expect(
      caller(capabilitiesFor('none', Level.Full)).learnedProvenance({ articleId: ARTICLE_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getLearnedProvenance).not.toHaveBeenCalled()
  })

  it('200s and keeps the subject at mail lens `read`', async () => {
    await expect(
      caller(capabilitiesFor('read')).learnedProvenance({ articleId: ARTICLE_ID })
    ).resolves.toEqual([
      {
        threadId: THREAD_ID,
        subject: 'Refund for order #1042',
        extractedAt: '2026-07-01T00:00:00Z',
      },
    ])
  })

  it('keeps the subject at lens `identity` — the tier that grants subject', async () => {
    getThreadLensBatch.mockResolvedValue(new Map([[THREAD_ID, 'identity']]))
    const [source] = await caller(capabilitiesFor('read')).learnedProvenance({
      articleId: ARTICLE_ID,
    })
    expect(source?.subject).toBe('Refund for order #1042')
  })

  it('nulls the subject at lens `metadata` — below the subject tier', async () => {
    getThreadLensBatch.mockResolvedValue(new Map([[THREAD_ID, 'metadata']]))
    const [source] = await caller(capabilitiesFor('read')).learnedProvenance({
      articleId: ARTICLE_ID,
    })
    expect(source).toEqual({
      threadId: THREAD_ID,
      subject: null,
      extractedAt: '2026-07-01T00:00:00Z',
    })
  })

  it('nulls the subject for a thread absent from the lens map (deleted / invisible)', async () => {
    getThreadLensBatch.mockResolvedValue(new Map())
    const [source] = await caller(capabilitiesFor('read')).learnedProvenance({
      articleId: ARTICLE_ID,
    })
    expect(source?.subject).toBeNull()
  })

  it('skips the lens read entirely when the article has no provenance', async () => {
    getLearnedProvenance.mockResolvedValue([])
    await expect(
      caller(capabilitiesFor('read')).learnedProvenance({ articleId: ARTICLE_ID })
    ).resolves.toEqual([])
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })
})
