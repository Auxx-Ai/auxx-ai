// packages/lib/src/channels/manage-access.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `listManageableChannelIds` — the batched form of `canManageChannel` (plan
 * `labels/refactor-functional-module.md` §5.3).
 *
 * Two properties are worth pinning. First, the personal-channel carve-out must
 * survive batching: #1396 exists because a personal-channel owner holds no
 * `channels.manage` at all, so a scope that only honoured the capability would
 * silently hide their own channel's config — an OVER-denial, which a
 * denial-shaped suite cannot see. Second, a channel with no inbox link is
 * excluded here even though `channels/list.ts` keeps it VISIBLE; that divergence
 * is deliberate (§5.3) and the `inboxId === null` case below is what forces a
 * later "consistency fix" to break a test rather than quietly change authority.
 *
 * `getCapabilities` and both org-cache reads are stubbed — the function performs
 * no DB work, so there is nothing else to stand up.
 */

const { fixture, getCapabilities } = vi.hoisted(() => {
  const fixture = {
    keys: new Set<string>(),
    channels: [] as Array<{ id: string; inboxId: string | null }>,
    inboxes: [] as Array<{ id: string; isPersonal: boolean; ownerUserId: string | null }>,
  }
  return {
    fixture,
    getCapabilities: vi.fn(async () => ({ can: (k: string) => fixture.keys.has(k) }) as never),
  }
})

// The real `PermissionKey` — a stubbed enum would let a renamed key pass.
vi.mock('../permissions', async () => {
  const { PermissionKey } = await import('../permissions/capabilities/registry')
  return { PermissionKey, getCapabilities }
})

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    get: async (_organizationId: string, key: string) =>
      key === 'channels' ? fixture.channels : fixture.inboxes,
  }),
}))

const { listManageableChannelIds } = await import('./manage-access')

const ORG = 'org_cuid000000000000000000000'
const OWNER = 'usr_owner00000000000000000'
const OTHER = 'usr_other00000000000000000'

const OWN_PERSONAL_INBOX = 'ibx_own_personal'
const OTHER_PERSONAL_INBOX = 'ibx_other_personal'
const UNCLAIMED_PERSONAL_INBOX = 'ibx_unclaimed_personal'
const SHARED_INBOX = 'ibx_shared'

const OWN_CHANNEL = 'int_own_personal'
const OTHER_CHANNEL = 'int_other_personal'
const UNCLAIMED_CHANNEL = 'int_unclaimed_personal'
const SHARED_CHANNEL = 'int_shared'
const UNLINKED_CHANNEL = 'int_unlinked'

const ctx = (userId: string) => ({ db: {} as never, organizationId: ORG, userId })

beforeEach(() => {
  fixture.keys = new Set()
  fixture.channels = [
    { id: OWN_CHANNEL, inboxId: OWN_PERSONAL_INBOX },
    { id: OTHER_CHANNEL, inboxId: OTHER_PERSONAL_INBOX },
    { id: UNCLAIMED_CHANNEL, inboxId: UNCLAIMED_PERSONAL_INBOX },
    { id: SHARED_CHANNEL, inboxId: SHARED_INBOX },
    { id: UNLINKED_CHANNEL, inboxId: null },
  ]
  fixture.inboxes = [
    { id: OWN_PERSONAL_INBOX, isPersonal: true, ownerUserId: OWNER },
    { id: OTHER_PERSONAL_INBOX, isPersonal: true, ownerUserId: OTHER },
    { id: UNCLAIMED_PERSONAL_INBOX, isPersonal: true, ownerUserId: null },
    { id: SHARED_INBOX, isPersonal: false, ownerUserId: null },
  ]
})

describe('listManageableChannelIds', () => {
  it('returns an unrestricted scope for a `channels.manage` holder', async () => {
    fixture.keys = new Set(['channels.manage'])

    await expect(listManageableChannelIds(ctx(OWNER))).resolves.toEqual({ kind: 'all' })
  })

  it('allowlists exactly the personal channel of an owner without `channels.manage`', async () => {
    const scope = await listManageableChannelIds(ctx(OWNER))

    expect(scope).toEqual({ kind: 'ids', integrationIds: [OWN_CHANNEL] })
  })

  it("excludes another member's personal channel", async () => {
    const scope = await listManageableChannelIds(ctx(OWNER))

    expect(scope).toEqual(expect.objectContaining({ kind: 'ids' }))
    expect((scope as { integrationIds: string[] }).integrationIds).not.toContain(OTHER_CHANNEL)
  })

  it('excludes shared channels without `channels.manage`', async () => {
    const scope = await listManageableChannelIds(ctx(OWNER))

    expect((scope as { integrationIds: string[] }).integrationIds).not.toContain(SHARED_CHANNEL)
  })

  it('excludes a channel with no inbox link (§5.3 divergence from channels/list.ts)', async () => {
    const scope = await listManageableChannelIds(ctx(OWNER))

    expect((scope as { integrationIds: string[] }).integrationIds).not.toContain(UNLINKED_CHANNEL)
  })

  /**
   * An UNCLAIMED personal inbox (`isPersonal` with a null `ownerUserId`) is a real
   * state — this module exports `claimPersonalInbox`/`provisionPersonalInbox`, so a
   * personal mailbox exists before anyone owns it. Nobody may manage its channel
   * except a `channels.manage` holder, and the `=== ctx.userId` comparison is the
   * only thing enforcing that: loosen it to a truthiness or `!=` check and every
   * member inherits authority over every unclaimed mailbox.
   */
  it('excludes an unclaimed personal channel, for every non-admin member', async () => {
    for (const userId of [OWNER, OTHER]) {
      const scope = await listManageableChannelIds(ctx(userId))
      expect((scope as { integrationIds: string[] }).integrationIds).not.toContain(
        UNCLAIMED_CHANNEL
      )
    }
  })

  it('returns an EMPTY allowlist, not `all`, when nothing is manageable', async () => {
    // Sanity first: this user DOES get their own channel while their inbox exists,
    // so the empty result below is the ownership check firing, not an empty fixture.
    await expect(listManageableChannelIds(ctx(OTHER))).resolves.toEqual({
      kind: 'ids',
      integrationIds: [OTHER_CHANNEL],
    })

    fixture.inboxes = fixture.inboxes.filter((i) => i.id !== OTHER_PERSONAL_INBOX)

    expect(await listManageableChannelIds(ctx(OTHER))).toEqual({ kind: 'ids', integrationIds: [] })
  })
})
