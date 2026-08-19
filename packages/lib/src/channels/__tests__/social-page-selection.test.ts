// packages/lib/src/channels/__tests__/social-page-selection.test.ts
//
// Phase two of the Facebook / Instagram connect: the candidate rules, and turning a chosen Page
// into a channel. The two things worth pinning here are the STALE-CACHE guard (a Page that is no
// longer on the grant must never produce an Integration) and the probe-avoidance rule, which is
// asserted by call count rather than by outcome — an implementation that probed every page would
// still return the right candidates and pass an outcome-only test.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  setChannelTokens,
  assertSharedConnectInbox,
  upsertSocialIntegration,
  cacheAvailablePages,
  subscribePageToApp,
  resolveUserTokenForCredential,
  readPendingSelection,
  clearPendingSelection,
  addIntegration,
  publishLater,
} = vi.hoisted(() => ({
  setChannelTokens: vi.fn(async () => {}),
  assertSharedConnectInbox: vi.fn(async () => 'rec_inbox'),
  upsertSocialIntegration: vi.fn(async () => ({ id: 'int_1', isNew: true, displayName: 'Acme' })),
  cacheAvailablePages: vi.fn(async () => {}),
  subscribePageToApp: vi.fn(async () => {}),
  resolveUserTokenForCredential: vi.fn(async () => 'user-token'),
  readPendingSelection: vi.fn(async (): Promise<unknown> => null),
  clearPendingSelection: vi.fn(async () => {}),
  addIntegration: vi.fn(async () => {}),
  publishLater: vi.fn(async () => {}),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@auxx/credentials', () => ({
  configService: {
    get: (key: string) =>
      ({ FACEBOOK_APP_ID: 'app-id', FACEBOOK_APP_SECRET: 'app-secret' })[key] ?? '',
  },
}))
vi.mock('@auxx/database', () => ({
  database: { query: { InboxIntegration: { findFirst: vi.fn(async () => undefined) } } },
  schema: new Proxy({}, { get: () => ({}) }),
}))
vi.mock('../../cache', () => ({ onCacheEvent: vi.fn(async () => {}) }))
vi.mock('../../events', () => ({ publisher: { publishLater } }))
vi.mock('../../inboxes/inbox-service', () => ({
  InboxService: class {
    addIntegration = addIntegration
  },
}))
vi.mock('../../providers/channel-token-accessor', () => ({ setChannelTokens }))
vi.mock('../../providers/social/api', () => ({
  graphApiVersion: () => 'v26.0',
  SOCIAL_SUBSCRIBED_FIELDS: { facebook: [], instagram: [] },
  subscribePageToApp: vi.fn(async () => {}),
}))
vi.mock('../connect-inbox', () => ({ assertSharedConnectInbox }))
vi.mock('../../connections/pending-selection', () => ({
  readPendingSelection,
  clearPendingSelection,
}))
// PARTIAL: only the writers and the token resolver are replaced. The Graph reads live in
// `providers/social/connect-api` and stay real so the `fetch` stub drives them.
vi.mock('../internal/social-integration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../internal/social-integration')>()),
  resolveUserTokenForCredential,
  upsertSocialIntegration,
  cacheAvailablePages,
  subscribePageToApp,
}))

const { provisionSocialChannel, selectSocialCandidates, noLinkedInstagramError } = await import(
  '../social-page-selection'
)

const ORG = 'org_cuid000000000000000000000'
const USER = 'usr_cuid000000000000000000000'
const CRED = 'cred_cuid00000000000000000000'

interface StubPage {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id?: string; username?: string }
}

function page(id: string, name: string, ig?: { id: string; username: string }): StubPage {
  return {
    id,
    name,
    access_token: `${id}-token`,
    ...(ig && { instagram_business_account: ig }),
  }
}

function stubGraph(options: {
  pages?: StubPage[]
  pagesFail?: boolean
  igProbe?: Record<string, { id: string; username: string }>
}) {
  const pages = options.pages ?? [page('page-1', 'Acme')]
  const probes = options.igProbe ?? {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input)
      if (url.includes('/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'long-lived' }) }
      }
      if (url.includes('/me/accounts')) {
        if (options.pagesFail) {
          return {
            ok: false,
            json: async () => ({ error: { message: 'Error validating access token' } }),
          }
        }
        return { ok: true, json: async () => ({ data: pages }) }
      }
      if (url.includes('/me?fields=id')) {
        return { ok: true, status: 200, json: async () => ({ id: 'asid-1' }) }
      }
      const pageId = url.split('/').pop()?.split('?')[0] ?? ''
      const hit = probes[pageId]
      return {
        ok: true,
        status: 200,
        json: async () => (hit ? { instagram_business_account: hit } : {}),
      }
    })
  )
}

function pendingFor(provider: 'facebook' | 'instagram', pages: StubPage[]) {
  return {
    kind: 'social-page-selection',
    providerKey: provider,
    createdAt: '2026-08-18T00:00:00.000Z',
    payload: {
      provider,
      inboxRecordId: 'rec_inbox',
      facebookUserId: 'asid-1',
      candidateIds: pages.map((p) => p.id),
      pages: pages.map((p) => ({ id: p.id, name: p.name })),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  readPendingSelection.mockResolvedValue(null)
  upsertSocialIntegration.mockResolvedValue({ id: 'int_1', isNew: true, displayName: 'Acme' })
})

describe('selectSocialCandidates', () => {
  it('takes every Page for Facebook and probes nothing', async () => {
    const probe = vi.fn(async () => null)
    const pages = [page('a', 'A'), page('b', 'B')]

    const result = await selectSocialCandidates('facebook', pages as never, probe)

    expect(result.candidates.map((p) => p.id)).toEqual(['a', 'b'])
    expect(probe).not.toHaveBeenCalled()
  })

  it('uses the EXPANDED pages and probes nothing when any came back expanded', async () => {
    const probe = vi.fn(async () => null)
    const pages = [page('a', 'A'), page('b', 'B', { id: 'ig-b', username: 'bee' })]

    const result = await selectSocialCandidates('instagram', pages as never, probe)

    // Asserted by CALL COUNT: an implementation that probed page `a` anyway would return the
    // same candidates and pass an outcome-only assertion.
    expect(probe).not.toHaveBeenCalled()
    expect(result.candidates.map((p) => p.id)).toEqual(['b'])
    expect(result.instagramByPageId.get('b')).toEqual({ id: 'ig-b', username: 'bee' })
  })

  it('probes EVERY page only when nothing came back expanded', async () => {
    const probe = vi.fn(async (pageId: string) =>
      pageId === 'b' ? { id: 'ig-b', username: 'bee' } : null
    )
    const pages = [page('a', 'A'), page('b', 'B')]

    const result = await selectSocialCandidates('instagram', pages as never, probe)

    expect(probe).toHaveBeenCalledTimes(2)
    expect(result.candidates.map((p) => p.id)).toEqual(['b'])
  })

  it('throws the multi-cause error when the probe finds nothing either', async () => {
    const probe = vi.fn(async () => null)
    const pages = [page('a', 'Acme'), page('b', 'Beta')]

    await expect(selectSocialCandidates('instagram', pages as never, probe)).rejects.toThrow(
      noLinkedInstagramError(pages as never).message
    )
  })
})

describe('provisionSocialChannel', () => {
  it('provisions from the pending marker and clears it before publishing', async () => {
    const pages = [page('page-1', 'Acme'), page('page-2', 'Beta')]
    readPendingSelection.mockResolvedValue(pendingFor('facebook', pages))
    stubGraph({ pages })

    const result = await provisionSocialChannel({
      credentialId: CRED,
      organizationId: ORG,
      userId: USER,
      pageId: 'page-2',
    })

    expect(result).toEqual({ integrationId: 'int_1' })
    expect(upsertSocialIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'facebook',
        identity: expect.objectContaining({ pageId: 'page-2', facebookUserId: 'asid-1' }),
      })
    )
    expect(addIntegration).toHaveBeenCalledWith('rec_inbox', 'int_1')

    // Ordering, both directions: tokens land before the webhook is armed, and the marker is gone
    // before anything downstream can observe a provisioned channel that still claims to be
    // waiting on a choice.
    const order = (m: { mock: { invocationCallOrder: number[] } }) => m.mock.invocationCallOrder[0]!
    expect(order(setChannelTokens)).toBeLessThan(order(subscribePageToApp))
    expect(order(clearPendingSelection)).toBeLessThan(order(publishLater))
  })

  it('refuses a Page that is no longer on the grant, and writes nothing', async () => {
    const pages = [page('page-1', 'Acme')]
    readPendingSelection.mockResolvedValue(
      pendingFor('facebook', [page('page-1', 'Acme'), page('page-2', 'Beta')])
    )
    stubGraph({ pages })

    await expect(
      provisionSocialChannel({
        credentialId: CRED,
        organizationId: ORG,
        userId: USER,
        pageId: 'page-2',
      })
    ).rejects.toThrow(/no longer available on this Facebook account/)

    // The stale-cache guard: the marker still lists page-2, the live fetch does not.
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
    expect(setChannelTokens).not.toHaveBeenCalled()
  })

  it('rejects when there is no marker and no explicit inbox', async () => {
    stubGraph({})

    await expect(
      provisionSocialChannel({
        credentialId: CRED,
        organizationId: ORG,
        userId: USER,
        pageId: 'page-1',
      })
    ).rejects.toThrow(/no page selection waiting/)
  })

  it('provisions with an EXPLICIT inbox and no marker at all', async () => {
    // The "add another Page from this connection" entry point: the marker is one SOURCE of the
    // inbox, never a precondition. If this regresses, that feature stops being a call site.
    stubGraph({ pages: [page('page-1', 'Acme')] })

    const result = await provisionSocialChannel({
      credentialId: CRED,
      organizationId: ORG,
      userId: USER,
      pageId: 'page-1',
      inboxRecordId: 'rec_other',
    })

    expect(result).toEqual({ integrationId: 'int_1' })
    expect(assertSharedConnectInbox).toHaveBeenCalledWith(expect.anything(), ORG, 'rec_other')
    // Nothing to clear — and clearing unconditionally would be a pointless write on this path.
    expect(clearPendingSelection).not.toHaveBeenCalled()
  })

  it('reports an expired session, rather than a Graph error, when the token is dead', async () => {
    readPendingSelection.mockResolvedValue(pendingFor('facebook', [page('page-1', 'Acme')]))
    stubGraph({ pagesFail: true })

    await expect(
      provisionSocialChannel({
        credentialId: CRED,
        organizationId: ORG,
        userId: USER,
        pageId: 'page-1',
      })
    ).rejects.toThrow(/Facebook session has expired/)
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
  })

  it('names the chosen Page when it has no linked Instagram account', async () => {
    const pages = [page('page-1', 'Acme')]
    readPendingSelection.mockResolvedValue(pendingFor('instagram', pages))
    stubGraph({ pages })

    // Distinct from the phase-one "none anywhere" text: here the user picked a specific Page.
    await expect(
      provisionSocialChannel({
        credentialId: CRED,
        organizationId: ORG,
        userId: USER,
        pageId: 'page-1',
      })
    ).rejects.toThrow(/“Acme” has no linked Instagram Professional account/)
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
  })
})
