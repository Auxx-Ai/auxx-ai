// packages/lib/src/inboxes/personal-inbox-def-consumers.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
// Deep import — the `@auxx/lib/permissions` barrel hangs under vitest.
import { Level } from '../permissions/capabilities/registry'
import { bucketInstanceGrantRows } from '../resource-access/instance-grants'

/**
 * Plan 40 phase 1, seams 4 + 5 and the 40a §9 union-completeness bar.
 *
 * The whole point of merging both inbox definitions inside the `inboxes`
 * org-cache provider is that its ~20 consumers need no def awareness. This file
 * asserts that claim from the consumer side, in BOTH directions:
 *
 *  - **PRESENT**: a `personal_inbox` mailbox reaches ingest meta (Gmail
 *    parity), the personal-inbox capping in the realtime/count audience, and
 *    `personalInboxIds` in both of its producers.
 *  - **ABSENT**: it is still excluded from automation scope, workflow
 *    mail-trigger eligibility and shared-channel connect targets.
 *
 * The absence half is the one that silently regresses — a leak here is a
 * private mailbox being automated or routed to, with nothing thrown.
 *
 * Every case is driven twice where it matters: once with the mailbox on the new
 * def and NO legacy marker (post-060), once on the shared def carrying the
 * marker (pre-060). Both must behave identically, or phase 1 is not inert.
 */

const { getOrgCache, getInboxById } = vi.hoisted(() => ({
  getOrgCache: vi.fn(),
  getInboxById: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache,
  onCacheEvent: vi.fn(async () => undefined),
  getUserCache: () => ({ get: async () => ({ isAdmin: false, inboxLens: {} }) }),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getCachedUserInstanceGrants: vi.fn(),
  getCachedMembers: vi.fn(async () => []),
}))
// The shared-only guards below read one inbox through the service; the service
// itself (and its own def resolution) is covered in `inbox-service-def-union`.
vi.mock('./inbox-service', () => ({
  InboxService: class {
    getInboxById = getInboxById
  },
}))

const { getAutomationVisibility } = await import('../permissions/visibility/automation-visibility')
const { getFullLensAudienceForInbox } = await import('../permissions/visibility/audience')
const { composeUserInstanceGrants } = await import(
  '../permissions/visibility/compute-user-instance-grants'
)
const { getInboxMeta, isPersonalInbox } = await import('../ingest/inbox-meta')
const { assertMailTriggerNotPersonal } = await import('../workflows/mail-trigger-guard')
const { assertSharedConnectInbox } = await import('../channels/connect-inbox')

const ORG = 'org_1'
const OWNER = 'usr_owner'
const OTHER = 'usr_other'
const SHARED_ID = 'ibx_shared'
const PERSONAL_ID = 'ibx_personal'

type CachedInbox = {
  id: string
  entityDefinitionKey: 'inbox' | 'personal_inbox'
  defaultLens: 'none' | 'metadata' | 'identity' | 'read'
  isPersonal: boolean
  ownerUserId: string | null
}

const sharedInbox: CachedInbox = {
  id: SHARED_ID,
  entityDefinitionKey: 'inbox',
  defaultLens: 'read',
  isPersonal: false,
  ownerUserId: null,
}

/**
 * The two shapes the SAME personal mailbox takes across the def move. Both are
 * produced by `InboxService.derivePersonal`; consumers must not be able to tell
 * them apart.
 */
const personalOnNewDef: CachedInbox = {
  id: PERSONAL_ID,
  entityDefinitionKey: 'personal_inbox',
  defaultLens: 'none',
  isPersonal: true,
  ownerUserId: OWNER,
}
const personalOnLegacyDef: CachedInbox = { ...personalOnNewDef, entityDefinitionKey: 'inbox' }

const BOTH_ERAS: Array<[string, CachedInbox]> = [
  ['post-060 (own def, no marker)', personalOnNewDef],
  ['pre-060 (shared def + marker)', personalOnLegacyDef],
]

/** Wire the org cache with a merged inbox list plus whatever else a consumer reads. */
function mockCache(inboxes: CachedInbox[], extra: Record<string, unknown> = {}) {
  getOrgCache.mockReturnValue({
    get: async (_org: string, key: string) => {
      if (key === 'inboxes') return inboxes
      if (key in extra) return extra[key]
      throw new Error(`unexpected org cache key: ${key}`)
    },
  })
}

beforeEach(() => {
  getOrgCache.mockReset()
  getInboxById.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// PRESENT
// ─────────────────────────────────────────────────────────────────────────────

describe('PRESENT — ingest meta sees the personal mailbox (Gmail parity input)', () => {
  for (const [era, personal] of BOTH_ERAS) {
    it(`resolves isPersonal + owner ${era}`, async () => {
      mockCache([sharedInbox, personal])
      const ctx = { organizationId: ORG } as never

      // Personal channel: `sync-messages` keeps INBOX-label removal as an
      // ARCHIVE (thread-level Done) and `store-message` derives thread status
      // from labels. Both branch on exactly this boolean.
      await expect(getInboxMeta(ctx, PERSONAL_ID)).resolves.toEqual({
        isPersonal: true,
        ownerUserId: OWNER,
      })
      await expect(isPersonalInbox(ctx, PERSONAL_ID)).resolves.toBe(true)

      // Shared channel: INBOX-label removal DELETES locally, thread status
      // stays OPEN. The negative half of the same branch.
      await expect(isPersonalInbox(ctx, SHARED_ID)).resolves.toBe(false)
    })
  }

  it('unknown inbox ids stay null (fail toward shared semantics)', async () => {
    mockCache([sharedInbox])
    const ctx = { organizationId: ORG } as never
    await expect(getInboxMeta(ctx, 'ibx_missing')).resolves.toBeNull()
    await expect(isPersonalInbox(ctx, null)).resolves.toBe(false)
  })
})

describe('PRESENT — the full-lens audience still caps a personal mailbox', () => {
  for (const [era, personal] of BOTH_ERAS) {
    it(`admits only the owner and explicit full-lens grantees ${era}`, async () => {
      mockCache([sharedInbox, personal], {
        members: [{ userId: OWNER }, { userId: OTHER }],
        memberRoleMap: { [OTHER]: { role: 'ADMIN' } },
        mailGrantIndex: { inboxes: {} },
      })
      await expect(getFullLensAudienceForInbox(ORG, PERSONAL_ID)).resolves.toEqual([OWNER])
    })
  }

  it('a shared inbox at floor `full` still fans out to every member', async () => {
    mockCache([sharedInbox], {
      members: [{ userId: OWNER }, { userId: OTHER }],
      memberRoleMap: {},
      mailGrantIndex: { inboxes: {} },
    })
    await expect(getFullLensAudienceForInbox(ORG, SHARED_ID)).resolves.toEqual([OWNER, OTHER])
  })
})

describe('PRESENT — personalInboxIds, both producers', () => {
  for (const [era, personal] of BOTH_ERAS) {
    it(`composeUserInstanceGrants caps OTHERS' personal mailbox ${era}`, async () => {
      const viewer = composeUserInstanceGrants({
        userId: OTHER,
        role: 'ADMIN',
        inboxesAreaLevel: Level.Full,
        inboxes: [sharedInbox, personal],
        instanceGrants: bucketInstanceGrantRows([]),
      })
      expect(viewer.personalInboxIds).toEqual({ [PERSONAL_ID]: true })
    })

    it(`composeUserInstanceGrants never caps the viewer's OWN mailbox ${era}`, async () => {
      const viewer = composeUserInstanceGrants({
        userId: OWNER,
        role: 'USER',
        inboxesAreaLevel: Level.Read,
        inboxes: [sharedInbox, personal],
        instanceGrants: bucketInstanceGrantRows([]),
      })
      expect(viewer.personalInboxIds).toEqual({})
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ABSENT — the half that regresses silently
// ─────────────────────────────────────────────────────────────────────────────

describe('ABSENT — automation scope excludes the personal mailbox (HEADLESS)', () => {
  for (const [era, personal] of BOTH_ERAS) {
    it(`marks it personal so automationScope skips it ${era}`, async () => {
      // Automation, ingest, sequences and workflows write mail as the system
      // and read no member capabilities. This is the ONLY exclusion that
      // protects a personal mailbox on those paths.
      mockCache([sharedInbox, personal])
      const vis = await getAutomationVisibility(ORG)
      expect(vis.kind).toBe('automation')
      expect(vis.personalInboxIds).toEqual({ [PERSONAL_ID]: true })
    })
  }

  it('an org with no personal mailboxes evaluates like SYSTEM_VISIBILITY', async () => {
    mockCache([sharedInbox])
    const vis = await getAutomationVisibility(ORG)
    expect(vis.personalInboxIds).toEqual({})
  })
})

describe('ABSENT — workflow mail triggers reject a personal inbox', () => {
  const graph = {
    nodes: [{ type: 'message-received', data: { filters: { integrationId: 'int_1' } } }],
  }
  const dbWithLink = (inboxId: string) =>
    ({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ inboxId }] }) }),
      }),
    }) as never

  for (const [era, personal] of BOTH_ERAS) {
    it(`refuses a trigger on a channel routed to it ${era}`, async () => {
      mockCache([sharedInbox, personal])
      await expect(
        assertMailTriggerNotPersonal(dbWithLink(PERSONAL_ID), ORG, graph)
      ).rejects.toMatchObject({ name: 'BadRequestError', statusCode: 400 })
    })
  }

  it('allows a trigger on a shared inbox (positive control)', async () => {
    mockCache([sharedInbox, personalOnNewDef])
    await expect(
      assertMailTriggerNotPersonal(dbWithLink(SHARED_ID), ORG, graph)
    ).resolves.toBeUndefined()
  })
})

describe('ABSENT — a shared channel connect cannot target a personal inbox', () => {
  const serviceInbox = (inbox: CachedInbox) => ({
    ...inbox,
    organizationId: ORG,
    recordId: `${inbox.entityDefinitionKey}:${inbox.id}`,
  })

  for (const [era, personal] of BOTH_ERAS) {
    it(`rejects it ${era}`, async () => {
      getInboxById.mockResolvedValue(serviceInbox(personal))
      await expect(assertSharedConnectInbox({} as never, ORG, PERSONAL_ID)).rejects.toMatchObject({
        name: 'BadRequestError',
        statusCode: 400,
      })
    })
  }

  it('returns the shared inbox’s RecordId (positive control)', async () => {
    getInboxById.mockResolvedValue(serviceInbox(sharedInbox))
    await expect(assertSharedConnectInbox({} as never, ORG, SHARED_ID)).resolves.toBe(
      `inbox:${SHARED_ID}`
    )
  })

  it('rejects a missing id before any inbox read', async () => {
    await expect(assertSharedConnectInbox({} as never, ORG, undefined)).rejects.toMatchObject({
      name: 'BadRequestError',
    })
    expect(getInboxById).not.toHaveBeenCalled()
  })
})
