// packages/lib/src/channels/__tests__/social-provisioning-hook.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `socialProvisioningHook` — the connect must FAIL when the Facebook user id is unknown.
 *
 * The hole this pins: Meta's data-deletion and deauthorize callbacks POST a
 * `signed_request` whose payload carries `user_id` and nothing else — no page id, no
 * email, no org — so `Integration.metadata.userId` (written from
 * `SocialIdentity.facebookUserId`) is the ONLY key that can resolve such a callback to a
 * channel. `fetchFacebookUserId` used to swallow every error and return `undefined`, and
 * `discoverIdentity` never checked it, so a channel connected during a transient Graph
 * blip provisioned fine and was then permanently invisible to the callback: we would hand
 * Meta a confirmation code while the user's OAuth tokens sat untouched in `Credential`.
 *
 * So the assertions that matter are (1) the connect rejects with a message a user can act
 * on, and (2) it rejects BEFORE anything is provisioned — no page lookup, no token swap,
 * no Integration row. A retryable connect error is the correct trade against a silent
 * compliance hole.
 */

const { setChannelTokens, subscribePageToApp, assertSharedConnectInbox } = vi.hoisted(() => ({
  setChannelTokens: vi.fn(async () => {}),
  subscribePageToApp: vi.fn(async () => {}),
  assertSharedConnectInbox: vi.fn(async () => 'rec_inbox'),
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
vi.mock('../../cache', () => ({ onCacheEvent: vi.fn(async () => {}) }))
vi.mock('../../events', () => ({ publisher: { publishLater: vi.fn(async () => {}) } }))
vi.mock('../../inboxes/inbox-service', () => ({
  InboxService: class {
    addIntegration = vi.fn(async () => {})
  },
}))
vi.mock('../../providers/channel-token-accessor', () => ({ setChannelTokens }))
vi.mock('../../providers/social/api', () => ({
  SOCIAL_SUBSCRIBED_FIELDS: { facebook: [], instagram: [] },
  subscribePageToApp,
}))
vi.mock('../connect-inbox', () => ({ assertSharedConnectInbox }))
vi.mock('../../connections/resolve-connection-for-runtime', () => ({
  resolveConnectionForRuntime: async () => ({
    isErr: () => false,
    value: { organizationConnection: { value: 'short-lived-user-token' } },
  }),
}))

const { socialProvisioningHook } = await import('../social-provisioning-hook')

const ctx = {
  providerKey: 'facebook',
  organizationId: 'org_cuid000000000000000000000',
  userId: 'usr_cuid000000000000000000000',
  credentialId: 'cred_cuid00000000000000000000',
} as never

/** One fetch stub for all three Graph endpoints the hook can reach. */
function stubGraph(me: { status: number; body: unknown } | Error) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input)
      if (url.includes('/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'long-lived-user-token' }) }
      }
      if (url.includes('/me/accounts')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'page-1', name: 'Acme', access_token: 'page-token' }],
          }),
        }
      }
      // `/me?fields=id` — the one under test.
      if (me instanceof Error) throw me
      return { ok: me.status < 400, status: me.status, json: async () => me.body }
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('socialProvisioningHook — Facebook user id is mandatory', () => {
  it('rejects the connect when Graph errors on /me instead of provisioning an unlinkable channel', async () => {
    stubGraph({
      status: 400,
      body: { error: { message: 'Error validating access token: Session has expired' } },
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
    stubGraph({ status: 200, body: {} })

    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(
      /Could not retrieve your Facebook account: ensure permissions were granted/
    )
    expect(setChannelTokens).not.toHaveBeenCalled()
  })

  it('rejects with a readable message when the /me request itself fails', async () => {
    stubGraph(new Error('fetch failed'))

    // The network cause is surfaced, not a bare `TypeError: fetch failed`.
    await expect(socialProvisioningHook.run(ctx)).rejects.toThrow(
      /Could not retrieve your Facebook account: fetch failed\. Please try connecting again\./
    )
    expect(setChannelTokens).not.toHaveBeenCalled()
  })
})
