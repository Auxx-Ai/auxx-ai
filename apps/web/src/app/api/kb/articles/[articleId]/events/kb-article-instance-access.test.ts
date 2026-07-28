// apps/web/src/app/api/kb/articles/[articleId]/events/kb-article-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The KB article realtime SSE route — same class as the run-trace hole.
 *
 * Its ONLY authorization was "this article exists in the caller's org": it
 * selected `{ id }`, matched `Article.organizationId`, and opened a subscription
 * to `kb:article:<id>` with no capability read and no instance assert. That
 * channel carries `kb-article-resync`, whose payload is the article's ENTIRE
 * `contentJson`, emitted on every manual save, Kopilot turn and revert (plus
 * `kb-article-patch`'s block-level diffs). So any authenticated org member could
 * tail the live body of any article — including one in a KB they hold an
 * explicit `none` restriction on. The tRPC sibling `kb.getArticleById` resolves
 * the parent KB and runs `assertViewInstance('kb', kbId)`.
 *
 * Behavioral: the real handler runs with a REAL `CapabilitySet`. Opening the
 * Redis subscription (`createDedicatedClient`) is the observed side effect — the
 * gate must land ahead of it, so an unauthorized caller never gets a stream.
 */

const { getCapabilities, getSession, select, articleLimit, createDedicatedClient, eq, and } =
  vi.hoisted(() => ({
    getCapabilities: vi.fn(),
    getSession: vi.fn(),
    select: vi.fn(),
    articleLimit: vi.fn(),
    createDedicatedClient: vi.fn(),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  }))

vi.mock('@auxx/database', () => ({
  database: { select },
  schema: {
    Article: {
      id: 'Article.id',
      organizationId: 'Article.organizationId',
      homeKnowledgeBaseId: 'Article.homeKnowledgeBaseId',
    },
  },
}))

vi.mock('drizzle-orm', () => ({ and, eq }))

// The `@auxx/lib/permissions` barrel HANGS under vitest (get-capabilities,
// record-view-scope, overage-*) — stub it, keep the enums real via `/client`.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))
vi.mock('@auxx/lib/kb', () => ({
  kbArticleChannel: (articleId: string) => `kb:article:${articleId}`,
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@auxx/redis', () => ({ createDedicatedClient }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const ARTICLE_ID = 'art_cuid000000000000000000000'
/** The article's home `KnowledgeBase.id` — what instance access keys on. */
const KB_ID = 'kb_cuid0000000000000000000000'

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** A real `CapabilitySet` holding `permission` on {@link KB_ID} via an explicit row. */
function capabilitiesFor(permission: ResourcePermission, areaLevel = AREA_LEVEL_OF[permission]) {
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

function signedIn(capabilities: InstanceType<typeof CapabilitySet>) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const request = () =>
  ({
    headers: new Headers(),
    signal: new AbortController().signal,
  }) as never

const params = { params: Promise.resolve({ articleId: ARTICLE_ID }) }

/** Reads the first SSE chunk, then cancels so no heartbeat interval leaks. */
async function firstChunk(res: Response) {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const { value } = await reader.read()
  await reader.cancel()
  return new TextDecoder().decode(value)
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  articleLimit.mockReset().mockResolvedValue([{ id: ARTICLE_ID, homeKnowledgeBaseId: KB_ID }])
  eq.mockClear()
  and.mockClear()
  select.mockReset().mockReturnValue({
    from: () => ({ where: () => ({ limit: articleLimit }) }),
  })
  createDedicatedClient.mockReset().mockResolvedValue({
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  })
})

describe('GET /api/kb/articles/[articleId]/events — the article-body hole', () => {
  it('401s without a session, before any capability or DB read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a member composing `knowledgeBase: None`, before the stream opens', async () => {
    signedIn(areaOnly(Level.None))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(res.headers.get('Content-Type')).not.toBe('text/event-stream')
    // The gate must precede the subscription — otherwise the caller is already
    // attached to the channel when the next resync lands.
    expect(createDedicatedClient).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on the KB', async () => {
    // THE case this fix exists for: the area is wide open (Full), and only the
    // per-instance `none` row stands between the caller and the article body.
    // Before the fix this member got the full stream.
    signedIn(capabilitiesFor(ResourcePermission.none, Level.Full))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(createDedicatedClient).not.toHaveBeenCalled()
  })

  it('streams for a member holding instance `view` on the KB', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(await firstChunk(res)).toContain('event: connected')
  })

  it('streams for a row-less KB at the area Read rung (baselineAtCreate: false)', async () => {
    // KBs are org-shared by default (doc 12 §0.2): with no `ResourceAccess` row
    // anywhere, the absent-row fallback IS the area level.
    signedIn(areaOnly(Level.Read))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(await firstChunk(res)).toContain('event: connected')
  })

  it('gates on the home KB, not the article id', async () => {
    // The article id is what the URL carries, so keying the assert on it is the
    // easy mistake. Here the area is None and the ONLY grant is an explicit
    // `view` row on the KB — asserting against `ARTICLE_ID` would fall through
    // to the closed area level and 403 a member who legitimately has access.
    signedIn(capabilitiesFor(ResourcePermission.view, Level.None))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(await firstChunk(res)).toContain('event: connected')
  })

  it('selects the home KB id so the gate has a subject', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(select.mock.calls[0]?.[0]).toHaveProperty(
      'homeKnowledgeBaseId',
      'Article.homeKnowledgeBaseId'
    )
    await firstChunk(res)
  })

  it('404s an absent article without reading capabilities or opening a stream', async () => {
    // The read is org-scoped, so another org's article id is absent here too —
    // identical to an article that never existed.
    signedIn(capabilitiesFor(ResourcePermission.admin))
    articleLimit.mockResolvedValue([])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(createDedicatedClient).not.toHaveBeenCalled()
  })

  it('scopes the article read by organization', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(eq).toHaveBeenCalledWith('Article.organizationId', ORG_ID)
    await firstChunk(res)
  })

  it('403s a session with no organization, before any read', async () => {
    getSession.mockResolvedValue({ user: { id: USER_ID, isSuperAdmin: false } })
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})
