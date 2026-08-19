// packages/lib/src/channels/__tests__/social-provisioning-hook.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `socialProvisioningHook` — two things this file exists to pin.
 *
 * **1. The connect must FAIL when the Facebook user id is unknown.**
 * Meta's data-deletion and deauthorize callbacks POST a `signed_request` whose payload carries
 * `user_id` and nothing else — no page id, no email, no org — so `Integration.metadata.userId`
 * (written from `SocialIdentity.facebookUserId`) is the ONLY key that can resolve such a callback
 * to a channel. `fetchFacebookUserId` used to swallow every error and return `undefined`, and
 * nothing checked it, so a channel connected during a transient Graph blip provisioned fine and
 * was then permanently invisible to the callback: we would hand Meta a confirmation code while
 * the user's OAuth tokens sat untouched in `Credential`. A retryable connect error is the correct
 * trade against a silent compliance hole.
 *
 * **2. An ambiguous grant must provision NOTHING.**
 * `/me/accounts` returns every Page the user administers. When more than one is a candidate the
 * hook parks a marker and returns `awaiting` — no Integration, no page token, no webhook — and
 * the picker finishes the connect. The highest-value assertion in the file is the negative one:
 * that the two-page case writes no tokens and arms no webhook.
 */

const {
  setChannelTokens,
  subscribePageToApp,
  assertSharedConnectInbox,
  upsertSocialIntegration,
  cacheAvailablePages,
  findLiveSocialIntegrationForCredential,
  writePendingSelection,
  deleteSupersededPendingCredentials,
} = vi.hoisted(() => ({
  setChannelTokens: vi.fn(async () => {}),
  subscribePageToApp: vi.fn(async () => {}),
  assertSharedConnectInbox: vi.fn(async () => 'rec_inbox'),
  upsertSocialIntegration: vi.fn(async () => ({
    id: 'int_1',
    isNew: true,
    displayName: 'Acme',
  })),
  cacheAvailablePages: vi.fn(async () => {}),
  findLiveSocialIntegrationForCredential: vi.fn(
    async (): Promise<{ id: string; pageId: string | null; pageName: string | null } | null> => null
  ),
  writePendingSelection: vi.fn(async () => {}),
  deleteSupersededPendingCredentials: vi.fn(async () => {}),
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
// The only DB touch left in the hook itself: the "is this channel already linked to an inbox"
// probe. Every other write goes through a module boundary mocked below.
vi.mock('@auxx/database', () => ({
  database: { query: { InboxIntegration: { findFirst: vi.fn(async () => undefined) } } },
  schema: new Proxy({}, { get: () => ({}) }),
}))
vi.mock('../../cache', () => ({ onCacheEvent: vi.fn(async () => {}) }))
vi.mock('../../events', () => ({ publisher: { publishLater: vi.fn(async () => {}) } }))
vi.mock('../../inboxes/inbox-service', () => ({
  InboxService: class {
    addIntegration = vi.fn(async () => {})
  },
}))
vi.mock('../../providers/channel-token-accessor', () => ({ setChannelTokens }))
vi.mock('../../providers/social/api', () => ({
  graphApiVersion: () => 'v26.0',
  SOCIAL_SUBSCRIBED_FIELDS: { facebook: [], instagram: [] },
  subscribePageToApp: vi.fn(async () => {}),
}))
vi.mock('../connect-inbox', () => ({ assertSharedConnectInbox }))
vi.mock('../../connections/resolve-connection-for-runtime', () => ({
  resolveConnectionForRuntime: async () => ({
    isErr: () => false,
    value: { organizationConnection: { value: 'short-lived-user-token' } },
  }),
}))
vi.mock('../../connections/pending-selection', () => ({
  writePendingSelection,
  deleteSupersededPendingCredentials,
}))
// PARTIAL mock: only the DB writers are replaced. The Graph reads in
// `providers/social/connect-api` stay REAL — they are what the `fetch` stub drives, and stubbing
// them would make every page-count assertion in this file vacuous.
vi.mock('../internal/social-integration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../internal/social-integration')>()),
  subscribePageToApp,
  upsertSocialIntegration,
  cacheAvailablePages,
}))
vi.mock('../social-page-selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../social-page-selection')>()),
  findLiveSocialIntegrationForCredential,
}))

const { socialProvisioningHook } = await import('../social-provisioning-hook')

const ctx = {
  providerKey: 'facebook',
  organizationId: 'org_cuid000000000000000000000',
  userId: 'usr_cuid000000000000000000000',
  credentialId: 'cred_cuid00000000000000000000',
} as never

const igCtx = { ...(ctx as object), providerKey: 'instagram' } as never

interface StubPage {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id?: string; username?: string }
}

/** One fetch stub for every Graph endpoint the hook can reach. */
function stubGraph(options: {
  me?: { status: number; body: unknown } | Error
  pages?: StubPage[]
  /** Per-page `?fields=instagram_business_account` probe results. */
  igProbe?: Record<string, { id: string; username: string }>
}) {
  const me = options.me ?? { status: 200, body: { id: 'asid-1' } }
  const pages = options.pages ?? [{ id: 'page-1', name: 'Acme', access_token: 'page-token' }]
  const probes = options.igProbe ?? {}
  const probeCalls: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input)
      if (url.includes('/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'long-lived-user-token' }) }
      }
      if (url.includes('/me/accounts')) {
        return { ok: true, json: async () => ({ data: pages }) }
      }
      if (url.includes('/me?fields=id')) {
        if (me instanceof Error) throw me
        return { ok: me.status < 400, status: me.status, json: async () => me.body }
      }
      // A per-page `instagram_business_account` probe.
      const pageId = url.split('/').pop()?.split('?')[0] ?? ''
      probeCalls.push(pageId)
      const hit = probes[pageId]
      return {
        ok: true,
        status: 200,
        json: async () => (hit ? { instagram_business_account: hit } : {}),
      }
    })
  )
  return { probeCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
  findLiveSocialIntegrationForCredential.mockResolvedValue(null)
})

describe('socialProvisioningHook — Facebook user id is mandatory', () => {
  it('rejects the connect when Graph errors on /me instead of provisioning an unlinkable channel', async () => {
    stubGraph({
      me: {
        status: 400,
        body: { error: { message: 'Error validating access token: Session has expired' } },
      },
    })

    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(
      /Could not retrieve your Facebook account: Error validating access token: Session has expired\. Please try connecting again\./
    )

    // Nothing was provisioned: the throw lands before the token swap and the webhook arm.
    expect(setChannelTokens).not.toHaveBeenCalled()
    expect(subscribePageToApp).not.toHaveBeenCalled()
    expect(assertSharedConnectInbox).not.toHaveBeenCalled()
  })

  it('rejects the connect when /me answers 200 with no id', async () => {
    stubGraph({ me: { status: 200, body: {} } })

    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(
      /Could not retrieve your Facebook account: ensure permissions were granted/
    )
    expect(setChannelTokens).not.toHaveBeenCalled()
  })

  it('rejects with a readable message when the /me request itself fails', async () => {
    stubGraph({ me: new Error('fetch failed') })

    // The network cause is surfaced, not a bare `TypeError: fetch failed`.
    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(
      /Could not retrieve your Facebook account: fetch failed\. Please try connecting again\./
    )
    expect(setChannelTokens).not.toHaveBeenCalled()
  })

  it('stays fatal with two pages — the ASID throw precedes the pending write', async () => {
    stubGraph({
      me: { status: 500, body: { error: { message: 'boom' } } },
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        { id: 'page-2', name: 'Beta', access_token: 't2' },
      ],
    })

    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(
      /Could not retrieve your Facebook account/
    )
    // The picker is NOT an escape hatch from the compliance invariant.
    expect(writePendingSelection).not.toHaveBeenCalled()
    expect(setChannelTokens).not.toHaveBeenCalled()
  })
})

describe('socialProvisioningHook — candidate gating', () => {
  it('still asks when the grant reaches exactly one Page', async () => {
    // A single Page is a confirmation, not a choice — and it runs anyway. Meta's app review has
    // to see what `pages_show_list` is used for, and an auto-selecting connect shows a reviewer
    // nothing. Reverting this to a zero-click path breaks that justification, not just a test.
    stubGraph({ pages: [{ id: 'page-1', name: 'Acme', access_token: 'page-token' }] })

    const result = await socialProvisioningHook.run(ctx)

    expect(result).toEqual({
      awaiting: { kind: 'social-page-selection', credentialId: 'cred_cuid00000000000000000000' },
    })
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
    expect(setChannelTokens).not.toHaveBeenCalled()
    expect(subscribePageToApp).not.toHaveBeenCalled()
    expect(writePendingSelection).toHaveBeenCalledWith(
      'cred_cuid00000000000000000000',
      'org_cuid000000000000000000000',
      expect.objectContaining({
        payload: expect.objectContaining({ candidateIds: ['page-1'] }),
      })
    )
  })

  it('provisions NOTHING when two Pages are candidates', async () => {
    stubGraph({
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        { id: 'page-2', name: 'Beta', access_token: 't2' },
      ],
    })

    const result = await socialProvisioningHook.run(ctx)

    expect(result).toEqual({
      awaiting: { kind: 'social-page-selection', credentialId: 'cred_cuid00000000000000000000' },
    })
    // The assertions that matter: no channel exists yet.
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
    expect(setChannelTokens).not.toHaveBeenCalled()
    expect(subscribePageToApp).not.toHaveBeenCalled()

    // The marker carries both candidate ids and the whole page list (the picker renders
    // non-candidates disabled), plus the ASID phase two refuses to provision without.
    expect(writePendingSelection).toHaveBeenCalledWith(
      'cred_cuid00000000000000000000',
      'org_cuid000000000000000000000',
      expect.objectContaining({
        kind: 'social-page-selection',
        providerKey: 'facebook',
        payload: expect.objectContaining({
          provider: 'facebook',
          inboxRecordId: 'rec_inbox',
          facebookUserId: 'asid-1',
          candidateIds: ['page-1', 'page-2'],
        }),
      })
    )
    expect(deleteSupersededPendingCredentials).toHaveBeenCalled()
  })

  it('rejects before writing a marker when the destination inbox is invalid', async () => {
    stubGraph({
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        { id: 'page-2', name: 'Beta', access_token: 't2' },
      ],
    })
    assertSharedConnectInbox.mockRejectedValueOnce(new Error('Pick an inbox') as never)

    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow('Pick an inbox')
    expect(writePendingSelection).not.toHaveBeenCalled()
  })
})

describe('socialProvisioningHook — reconnect forces the bound Page', () => {
  it('relinks the existing Page instead of showing a picker', async () => {
    stubGraph({
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        { id: 'page-2', name: 'Beta', access_token: 't2' },
      ],
    })
    findLiveSocialIntegrationForCredential.mockResolvedValue({
      id: 'int_1',
      pageId: 'page-2',
      pageName: 'Beta',
    })

    const result = await socialProvisioningHook.run({
      ...(ctx as object),
      connectionId: 'cred_x',
    } as never)

    expect(result).toBeUndefined()
    expect(writePendingSelection).not.toHaveBeenCalled()
    expect(upsertSocialIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ identity: expect.objectContaining({ pageId: 'page-2' }) })
    )
  })

  it('shows the picker again when the credential is PENDING (connectionId set, no Integration)', async () => {
    // The rule keys on the Integration, not on `connectionId`. Re-authing a pending credential
    // wipes its marker (an OAuth mint REPLACES `Credential.metadata`) and must land back in the
    // picker — keying on `connectionId` would dead-end the user with no marker and no picker.
    stubGraph({
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        { id: 'page-2', name: 'Beta', access_token: 't2' },
      ],
    })
    findLiveSocialIntegrationForCredential.mockResolvedValue(null)

    const result = await socialProvisioningHook.run({
      ...(ctx as object),
      connectionId: 'cred_x',
    } as never)

    expect(result).toMatchObject({ awaiting: { kind: 'social-page-selection' } })
    expect(writePendingSelection).toHaveBeenCalled()
  })

  it('errors, rather than picking a different Page, when the bound Page is no longer granted', async () => {
    stubGraph({ pages: [{ id: 'page-1', name: 'Acme', access_token: 't1' }] })
    findLiveSocialIntegrationForCredential.mockResolvedValue({
      id: 'int_1',
      pageId: 'page-gone',
      pageName: 'Gone Ltd',
    })

    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(/Gone Ltd/)
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
  })
})

describe('socialProvisioningHook — Instagram candidates', () => {
  it('offers only the one Page with a linked account, and probes nothing', async () => {
    const { probeCalls } = stubGraph({
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        {
          id: 'page-2',
          name: 'Beta',
          access_token: 't2',
          instagram_business_account: { id: 'ig-2', username: 'beta' },
        },
      ],
    })

    const result = await socialProvisioningHook.run(igCtx)

    expect(result).toMatchObject({ awaiting: { kind: 'social-page-selection' } })
    // Rule 2: something came back expanded, so the per-page probe never runs.
    expect(probeCalls).toEqual([])
    // `page-1` has no linked account, so it rides along as a DISABLED option rather than a
    // candidate — the picker renders the whole grant, and only candidates are selectable.
    expect(writePendingSelection).toHaveBeenCalledWith(
      'cred_cuid00000000000000000000',
      'org_cuid000000000000000000000',
      expect.objectContaining({
        payload: expect.objectContaining({
          candidateIds: ['page-2'],
          pages: [
            expect.objectContaining({ id: 'page-1' }),
            expect.objectContaining({ id: 'page-2', igBusinessAccountId: 'ig-2' }),
          ],
        }),
      })
    )
    expect(upsertSocialIntegration).not.toHaveBeenCalled()
  })

  it('asks when two Pages both have linked accounts', async () => {
    stubGraph({
      pages: [
        {
          id: 'page-1',
          name: 'Acme',
          access_token: 't1',
          instagram_business_account: { id: 'ig-1', username: 'acme' },
        },
        {
          id: 'page-2',
          name: 'Beta',
          access_token: 't2',
          instagram_business_account: { id: 'ig-2', username: 'beta' },
        },
      ],
    })

    const result = await socialProvisioningHook.run(igCtx)

    expect(result).toMatchObject({ awaiting: { kind: 'social-page-selection' } })
    expect(setChannelTokens).not.toHaveBeenCalled()
  })

  it('throws the exact multi-cause error when no Page anywhere has a linked account', async () => {
    stubGraph({
      pages: [
        { id: 'page-1', name: 'Acme', access_token: 't1' },
        { id: 'page-2', name: 'Beta', access_token: 't2' },
      ],
    })

    // Asserted against the LITERAL, not a loose regex: the wording names both causes (no linked
    // account vs. `instagram_basic` not granted) and is what a Meta reviewer sees. The point of
    // the test is that it does not drift into a paraphrase.
    await expect(socialProvisioningHook.run(igCtx)).rejects.toThrow(
      'No linked Instagram Professional account was found on any of the 2 managed Facebook ' +
        'Page(s) (Acme, Beta). Either no Instagram Professional account is linked to the Page, ' +
        'or the connection was granted without the instagram_basic permission — in which case ' +
        'Graph hides the link rather than reporting it.'
    )
    expect(writePendingSelection).not.toHaveBeenCalled()
  })
})
