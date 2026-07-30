// apps/web/src/server/api/routers/kb-instance-access.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 24 §A.4's KB half, at the router layer: **`edit` authors articles but must
 * not reach settings / publish / delete** (those are `assertAdminInstance`), and
 * `view` must not reach the article mutations. The UI gating from PR #1338 hides
 * those affordances; this pins the server truth the UI is mirroring.
 *
 * `ctx.capabilities` is a real {@link CapabilitySet}; `KBService` is the observed
 * side effect. Weakening any assert (admin→edit, edit→view) fails a case here.
 */

const { kbService, featureService, onCacheEvent, getUserOrganizationId, fireKBRevalidate } =
  vi.hoisted(() => ({
    kbService: {
      getKnowledgeBaseById: vi.fn(async () => ({ id: 'kb_1' })),
      listKnowledgeBases: vi.fn(async () => [] as { id: string }[]),
      createKnowledgeBase: vi.fn(async () => ({ id: 'kb_new' })),
      updateKnowledgeBase: vi.fn(async () => ({ id: 'kb_1' })),
      updateDraftSettings: vi.fn(async () => ({ id: 'kb_1' })),
      publishPendingSettings: vi.fn(async () => ({ id: 'kb_1' })),
      discardSettingsDraft: vi.fn(async () => ({ id: 'kb_1' })),
      deleteKnowledgeBase: vi.fn(async () => ({ success: true })),
      publishKnowledgeBase: vi.fn(async () => ({ id: 'kb_1' })),
      unpublishKnowledgeBase: vi.fn(async () => ({ id: 'kb_1' })),
      getArticles: vi.fn(async () => []),
      createArticle: vi.fn(async () => ({ id: 'art_1' })),
      deleteArticle: vi.fn(async () => ({ success: true })),
      updateArticlesBatch: vi.fn(async () => ({ updated: 1 })),
      getArticleSlugPath: vi.fn(async () => 'some/path'),
    },
    featureService: { requireAccess: vi.fn(async () => undefined) },
    onCacheEvent: vi.fn(async () => undefined),
    getUserOrganizationId: vi.fn(() => 'org_cuid000000000000000000000'),
    fireKBRevalidate: vi.fn(() => Promise.resolve()),
  }))

vi.mock('@auxx/lib/kb', () => ({
  KBService: class {
    getKnowledgeBaseById = kbService.getKnowledgeBaseById
    listKnowledgeBases = kbService.listKnowledgeBases
    createKnowledgeBase = kbService.createKnowledgeBase
    updateKnowledgeBase = kbService.updateKnowledgeBase
    updateDraftSettings = kbService.updateDraftSettings
    publishPendingSettings = kbService.publishPendingSettings
    discardSettingsDraft = kbService.discardSettingsDraft
    deleteKnowledgeBase = kbService.deleteKnowledgeBase
    publishKnowledgeBase = kbService.publishKnowledgeBase
    unpublishKnowledgeBase = kbService.unpublishKnowledgeBase
    getArticles = kbService.getArticles
    createArticle = kbService.createArticle
    deleteArticle = kbService.deleteArticle
    updateArticlesBatch = kbService.updateArticlesBatch
    getArticleSlugPath = kbService.getArticleSlugPath
  },
  ensureLearnedKb: vi.fn(async () => ({ kb: { id: 'kb_learned' } })),
  articleToMarkdown: vi.fn(() => ''),
  linkArticlesIntoKb: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/cache', () => ({ onCacheEvent }))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId }))
vi.mock('~/server/lib/kb-revalidate', () => ({ fireKBRevalidate }))

// See the note in `dataset-instance-access.test.ts` — the permissions barrel
// hangs under vitest; hand back the real enums plus a stub feature service.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const types = await import('@auxx/lib/permissions/types')
  return {
    PermissionKey: registry.PermissionKey,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = featureService.requireAccess
      requireAccessAndLimit = featureService.requireAccess
    },
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    // The real one blocks demo orgs; irrelevant to capability gating, and it must
    // stay downstream of the assert either way.
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

// Deep path on purpose — see the note in `segment-instance-access.test.ts`.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { knowledgeBaseRouter } = await import('./kb')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const KB_ID = 'kb_cuid00000000000000000000'
const ARTICLE_ID = 'art_cuid0000000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** A real `CapabilitySet` holding `permission` on {@link KB_ID} via an explicit row. */
function capabilitiesFor(
  permission: ResourcePermission,
  instances: Record<string, ResourcePermission> = { [KB_ID]: permission }
) {
  const areaLevel = {
    ['none']: Level.None,
    ['read']: Level.Read,
    ['edit']: Level.Edit,
    ['admin']: Level.Full,
  }[permission]
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

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return knowledgeBaseRouter.createCaller({
    db: {},
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as any)
}

/** Settings / publish / delete: Full only (`assertAdminInstance`). */
const ADMIN_ONLY = [
  [
    'update',
    (c: ReturnType<typeof caller>) => c.update({ id: KB_ID, data: { slug: 'help' } }),
    'updateKnowledgeBase',
  ],
  [
    'updateDraftSettings',
    (c: ReturnType<typeof caller>) => c.updateDraftSettings({ id: KB_ID, patch: { name: 'Help' } }),
    'updateDraftSettings',
  ],
  [
    'publishPendingSettings',
    (c: ReturnType<typeof caller>) => c.publishPendingSettings({ id: KB_ID }),
    'publishPendingSettings',
  ],
  [
    'discardSettingsDraft',
    (c: ReturnType<typeof caller>) => c.discardSettingsDraft({ id: KB_ID }),
    'discardSettingsDraft',
  ],
  ['delete', (c: ReturnType<typeof caller>) => c.delete({ id: KB_ID }), 'deleteKnowledgeBase'],
  [
    'publishSite',
    (c: ReturnType<typeof caller>) => c.publishSite({ id: KB_ID, status: 'PUBLISHED' }),
    'publishKnowledgeBase',
  ],
  [
    'unpublishSite',
    (c: ReturnType<typeof caller>) => c.unpublishSite({ id: KB_ID }),
    'unpublishKnowledgeBase',
  ],
] as const

/** Article authoring: Write (`assertEditInstance`). */
const EDIT_LEVEL = [
  [
    'createArticle',
    (c: ReturnType<typeof caller>) => c.createArticle({ knowledgeBaseId: KB_ID, title: 'New' }),
    'createArticle',
  ],
  [
    'deleteArticle',
    (c: ReturnType<typeof caller>) => c.deleteArticle({ id: ARTICLE_ID, knowledgeBaseId: KB_ID }),
    'deleteArticle',
  ],
  [
    'updateArticlesBatch',
    (c: ReturnType<typeof caller>) =>
      c.updateArticlesBatch({
        knowledgeBaseId: KB_ID,
        articles: [{ id: ARTICLE_ID, updates: { slug: 'a-slug' } }],
      }),
    'updateArticlesBatch',
  ],
] as const

beforeEach(() => {
  for (const fn of Object.values(kbService)) fn.mockClear()
})

describe('kb router — `edit` does not reach settings/publish/delete (plan 24 §A.4)', () => {
  it.each(ADMIN_ONLY)('%s is refused at instance edit', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('edit')))).rejects.toMatchObject(FORBIDDEN)
    expect(kbService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s is refused at instance view', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(kbService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s succeeds at instance admin', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('admin')))).resolves.toBeDefined()
    expect(kbService[serviceFn]).toHaveBeenCalledTimes(1)
  })

  it('creating a KB needs the coarse knowledgeBase Full rung, not instance edit', async () => {
    await expect(
      caller(capabilitiesFor('edit')).create({ name: 'Help', slug: 'help' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(kbService.createKnowledgeBase).not.toHaveBeenCalled()
  })
})

describe('kb router — article authoring is the edit rung', () => {
  it.each(EDIT_LEVEL)('%s succeeds at instance edit', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('edit')))).resolves.toBeDefined()
    expect(kbService[serviceFn]).toHaveBeenCalledTimes(1)
  })

  it.each(EDIT_LEVEL)('%s is refused at instance view', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(kbService[serviceFn]).not.toHaveBeenCalled()
  })
})

describe('kb router — reads stay open at instance view', () => {
  it('byId and getArticles succeed at view', async () => {
    const c = caller(capabilitiesFor('read'))
    await expect(c.byId({ id: KB_ID })).resolves.toBeDefined()
    await expect(c.getArticles({ knowledgeBaseId: KB_ID })).resolves.toBeDefined()
  })

  it('byId is refused with the instance restricted to none', async () => {
    await expect(
      caller(capabilitiesFor('read', { [KB_ID]: 'none' })).byId({
        id: KB_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(kbService.getKnowledgeBaseById).not.toHaveBeenCalled()
  })
})

describe('kb router — list drops instances the member may not view', () => {
  it('filters restricted KBs out of the list instead of 403ing', async () => {
    const RESTRICTED = 'kb_restrictedcuid00000000000'
    kbService.listKnowledgeBases.mockResolvedValueOnce([{ id: KB_ID }, { id: RESTRICTED }])

    await expect(
      caller(
        capabilitiesFor('read', {
          [KB_ID]: 'read',
          [RESTRICTED]: 'none',
        })
      ).list()
    ).resolves.toEqual([{ id: KB_ID }])
  })
})
