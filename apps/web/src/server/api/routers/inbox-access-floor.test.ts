// apps/web/src/server/api/routers/inbox-access-floor.test.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §6 — `inbox.setAccessFloor`, the replacement for the
 * `inbox_default_lens` field write.
 *
 * Editing an inbox's org-wide access level in the UI was a **live no-op**: the
 * form saved a FieldValue that nothing had read since phase 2 moved the floor
 * onto `role:org_member` `ResourceAccess` rows. This procedure is where the
 * write went instead, so it has to carry the two gates the retired field wall
 * (`guardInboxDefaultLens`) enforced, and no others:
 *
 *  - **Manager of THIS inbox** — NOT `channels.manage`, which governs the org's
 *    inbox INVENTORY (create/delete/route) rather than any one inbox's audience
 *    (§1.0). A non-admin inbox Manager must be able to do this; a
 *    `channels.manage` holder who manages nothing must not.
 *  - **Enterprise `mailPermissions`** for any sub-`full` floor. Notably NOT
 *    covered by `assertMailSharingFeature` on the generic sharing router: that
 *    gate keys on a non-`full` `lens`, and Restricted is `permission: 'none'`
 *    with a NULL lens.
 *
 * Both this and `myLenses` additionally sit behind the coarse mail front door
 * (`inboxes.view`, §5.3) — a strictly weaker gate that runs in MIDDLEWARE, i.e.
 * ahead of the handler. It must not shadow or reorder either of the two above,
 * which is what the "still refuses / still gates" cases below pin.
 *
 * Behavioral: the real router module is driven through a tRPC caller. Deleting
 * either assert makes the matching "refused" case fail, because the mocked write
 * would be reached.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_member00000000000000000'
/** An inbox the caller is Manager of. */
const OWN_INBOX = 'ibx_own00000000000000000000'
/** An inbox the caller manages nothing on. */
const OTHER_INBOX = 'ibx_other000000000000000000'
/** A personal mailbox — no org-wide floor exists to author. */
const PERSONAL_INBOX = 'ibx_personal000000000000000'

const { world, service, floor, recordIds } = vi.hoisted(() => {
  const world = {
    manage: new Set<string>(),
    personal: new Set<string>(),
    gated: false,
    /** The `org:inboxes` cache shape — `defaultLens` is the row-derived floor. */
    inboxes: [] as Array<{ id: string; defaultLens: string }>,
  }
  const instanceIdOf = (recordId: unknown) => String(recordId).split(':')[1] ?? String(recordId)
  return {
    world,
    service: {
      canManageInboxAccess: vi.fn(async (recordId: unknown) =>
        world.manage.has(instanceIdOf(recordId))
      ),
    },
    floor: {
      setInboxFloor: vi.fn(async () => undefined),
      assertInboxFloorFeature: vi.fn(async (_db, _org, _user, lens: string) => {
        if (world.gated && lens !== 'full') throw new Error('mailPermissions required')
      }),
    },
    recordIds: {
      toInboxRecordId: vi.fn(async (_org: string, inboxId: string) =>
        world.personal.has(inboxId) ? `personal_inbox:${inboxId}` : `inbox:${inboxId}`
      ),
      loadInboxDefKeys: vi.fn(async () => new Map()),
      inboxDefKeyOf: () => 'inbox',
    },
  }
})

vi.mock('@auxx/lib/inboxes', () => ({
  InboxService: class {
    canManageInboxAccess = service.canManageInboxAccess
  },
  setInboxFloor: floor.setInboxFloor,
  assertInboxFloorFeature: floor.assertInboxFloorFeature,
}))
vi.mock('@auxx/lib/inbox-record-ids', () => recordIds)
vi.mock('@auxx/lib/threads', () => ({ ThreadMutationService: class {} }))
vi.mock('@auxx/lib/channels', () => ({
  claimPersonalInbox: vi.fn(),
  deletePersonalInbox: vi.fn(),
}))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx: vi.fn(async () => undefined) }))
vi.mock('@auxx/lib/cache', () => ({
  getCachedUserMailVisibility: vi.fn(async () => ({ isAdmin: false, inboxLens: {} })),
  getOrgCache: () => ({ get: async () => world.inboxes }),
}))
vi.mock('@auxx/lib/permissions/visibility', () => ({ inboxLensFor: () => 'none' }))
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  return { PermissionKey: registry.PermissionKey }
})
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (k: string) => void } }).capabilities.assert(key)
        return next()
      }),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { inboxRouter } = await import('./inbox')

const FORBIDDEN_INSTANCE = { code: 'FORBIDDEN' }
/** The coarse front door throws an AuxxError; tRPC exposes it as `cause`. */
const FORBIDDEN_CAPABILITY = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const BAD_REQUEST = { code: 'BAD_REQUEST' }

function caller(
  opts: {
    role?: OrganizationRole
    seatType?: SeatType
    channels?: Level
    /** `Area.inboxes` — the coarse front door. Defaults to the Member baseline. */
    inboxes?: Level
    /** Front-door keys synthesized from instance grants (`instanceDerivedKeys`). */
    derivedKeys?: PermissionKey[]
  } = {}
) {
  const capabilities = new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.channels]: opts.channels ?? Level.None,
        [Area.inboxes]: opts.inboxes ?? Level.Read,
      })
    ),
    {},
    opts.role ?? 'MEMBER',
    opts.seatType ?? 'full',
    (id) => id,
    new Set(),
    (id) => id,
    {},
    new Set(),
    {},
    new Set(opts.derivedKeys ?? [])
  )
  return inboxRouter.createCaller({
    db: {},
    headers: new Headers(),
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never)
}

beforeEach(() => {
  // `mockReset()`, not `mockClear()` — a `mockResolvedValueOnce` queue survives
  // a clear and leaks into the next test.
  service.canManageInboxAccess.mockReset()
  service.canManageInboxAccess.mockImplementation(async (recordId: unknown) =>
    world.manage.has(String(recordId).split(':')[1] ?? '')
  )
  floor.setInboxFloor.mockReset()
  floor.setInboxFloor.mockResolvedValue(undefined as never)
  floor.assertInboxFloorFeature.mockReset()
  floor.assertInboxFloorFeature.mockImplementation(async (_db, _org, _user, lens: string) => {
    if (world.gated && lens !== 'full') throw new Error('mailPermissions required')
  })
  recordIds.toInboxRecordId.mockClear()
  world.manage = new Set([OWN_INBOX])
  world.personal = new Set([PERSONAL_INBOX])
  world.gated = false
  world.inboxes = []
})

describe('inbox.myLenses — the client’s only source for the row-derived floor', () => {
  it('publishes each inbox’s floor straight off the `org:inboxes` cache', async () => {
    // The floor is a `role:org_member` `ResourceAccess` row now, so the record
    // layer cannot see it — the access badges, the detail card and the share
    // popover's inherited-access footer all read it from here. Hard-code `full`
    // instead and every one of them shows the floor the org had before its last
    // edit, with nothing thrown.
    world.inboxes = [
      { id: OWN_INBOX, defaultLens: 'none' },
      { id: OTHER_INBOX, defaultLens: 'subject' },
      { id: PERSONAL_INBOX, defaultLens: 'none' },
    ]
    const result = await caller().myLenses()
    expect(result.floors).toEqual({
      [OWN_INBOX]: 'none',
      [OTHER_INBOX]: 'subject',
      [PERSONAL_INBOX]: 'none',
    })
  })

  it('reports `full` for an inbox with no authored baseline row', async () => {
    world.inboxes = [{ id: OWN_INBOX, defaultLens: 'full' }]
    await expect(caller().myLenses()).resolves.toMatchObject({
      floors: { [OWN_INBOX]: 'full' },
    })
  })
})

describe('inbox.setAccessFloor — who may author the floor', () => {
  it('an inbox MANAGER who is not an org admin may set it', () => {
    // The delegation case: `channels.manage` is `None` here on purpose.
    return expect(
      caller().setAccessFloor({ inboxId: OWN_INBOX, floorLens: 'none' })
    ).resolves.toEqual({ success: true })
  })

  it('writes the `role:org_member` row on the instance’s OWN definition', async () => {
    await caller().setAccessFloor({ inboxId: OWN_INBOX, floorLens: 'subject' })
    expect(floor.setInboxFloor).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
      `inbox:${OWN_INBOX}`,
      'subject'
    )
    // Canonicalized BEFORE the assert: the client mints inbox RecordIds from the
    // def CUID, and a wrong def matches no grant row — so the assert would deny
    // the inbox's own Manager and the row would land unread.
    expect(recordIds.toInboxRecordId).toHaveBeenCalledWith(ORG_ID, OWN_INBOX)
  })

  it('REFUSES a member who manages nothing on the inbox', async () => {
    await expect(
      caller().setAccessFloor({ inboxId: OTHER_INBOX, floorLens: 'none' })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(floor.setInboxFloor).not.toHaveBeenCalled()
  })

  it('REFUSES a `channels.manage` holder who manages nothing on the inbox', async () => {
    // Inventory ≠ audience (§1.0). Holding the coarse key must not confer the
    // ability to reopen or restrict an inbox somebody else runs.
    await expect(
      caller({ channels: Level.Full }).setAccessFloor({ inboxId: OTHER_INBOX, floorLens: 'full' })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(floor.setInboxFloor).not.toHaveBeenCalled()
  })

  it('REFUSES a personal mailbox — it has no org-wide floor to author', async () => {
    world.manage.add(PERSONAL_INBOX)
    await expect(
      caller().setAccessFloor({ inboxId: PERSONAL_INBOX, floorLens: 'full' })
    ).rejects.toMatchObject(BAD_REQUEST)
    expect(floor.setInboxFloor).not.toHaveBeenCalled()
  })
})

describe('the coarse mail front door does not shadow the manage assert (§5.3)', () => {
  it('`myLenses` and `setAccessFloor` are refused at inboxes: None', async () => {
    // The gap phase 3 left: both were bare `protectedProcedure`, so a profile at
    // `inboxes: None` did not close them. The manage assert made `setAccessFloor`
    // fail closed anyway, but `myLenses` handed out every inbox's floor.
    await expect(caller({ inboxes: Level.None }).myLenses()).rejects.toMatchObject(
      FORBIDDEN_CAPABILITY
    )
    await expect(
      caller({ inboxes: Level.None }).setAccessFloor({ inboxId: OWN_INBOX, floorLens: 'none' })
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    // Middleware answered first: the handler never ran, so neither the manage
    // assert nor the write was reached.
    expect(service.canManageInboxAccess).not.toHaveBeenCalled()
    expect(floor.setInboxFloor).not.toHaveBeenCalled()
  })

  it('OVER-DENIAL CONTROL: the delegated Manager at `inboxes: None` still passes', async () => {
    // A non-admin inbox Manager whose profile closes the area holds a `view`-or-
    // better instance row, so `composeUserCapabilities` synthesizes the Read rung
    // for them (`instanceDerivedKeys`, plan 25 §2). Gating this procedure must not
    // take away the delegation it exists to serve.
    await expect(
      caller({
        inboxes: Level.None,
        derivedKeys: [PermissionKey.inboxesView],
      }).setAccessFloor({ inboxId: OWN_INBOX, floorLens: 'none' })
    ).resolves.toEqual({ success: true })
  })

  it('the manage assert still runs BELOW the front door, in that order', async () => {
    // The middleware is a strictly weaker ADDITIONAL gate. A member who passes it
    // but manages nothing must still be refused — by the instance assert, with the
    // router-local `TRPCError` shape, not the capability one.
    await expect(
      caller({ inboxes: Level.Full }).setAccessFloor({ inboxId: OTHER_INBOX, floorLens: 'none' })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${OTHER_INBOX}`, USER_ID)
    expect(floor.setInboxFloor).not.toHaveBeenCalled()
  })

  it('and the Enterprise gate still fires below both', async () => {
    // `assertInboxFloorFeature` sits after the manage assert and before the write;
    // adding a middleware above must not reorder or skip it.
    world.gated = true
    await expect(
      caller({ inboxes: Level.Full }).setAccessFloor({ inboxId: OWN_INBOX, floorLens: 'subject' })
    ).rejects.toThrow(/mailPermissions/)
    expect(floor.assertInboxFloorFeature).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      USER_ID,
      'subject'
    )
    expect(floor.setInboxFloor).not.toHaveBeenCalled()
  })
})

describe('inbox.setAccessFloor — the Enterprise gate travels with the write', () => {
  it('gates every sub-`full` floor, INCLUDING Restricted (`none`, null lens)', async () => {
    world.gated = true
    for (const floorLens of ['none', 'metadata', 'subject'] as const) {
      floor.setInboxFloor.mockClear()
      await expect(caller().setAccessFloor({ inboxId: OWN_INBOX, floorLens })).rejects.toThrow(
        /mailPermissions/
      )
      expect(floor.setInboxFloor).not.toHaveBeenCalled()
    }
  })

  it('OVER-DENIAL CONTROL: raising back to `full` is always allowed', async () => {
    // Never gate a change that REMOVES the paid capability's effect — a gated
    // org must always be able to undo a restriction it can no longer author.
    world.gated = true
    await expect(
      caller().setAccessFloor({ inboxId: OWN_INBOX, floorLens: 'full' })
    ).resolves.toEqual({ success: true })
    expect(floor.setInboxFloor).toHaveBeenCalledWith(
      expect.anything(),
      `inbox:${OWN_INBOX}`,
      'full'
    )
  })

  it('OVER-DENIAL CONTROL: an ungated org may author every tier', async () => {
    for (const floorLens of ['none', 'metadata', 'subject', 'full'] as const) {
      await expect(caller().setAccessFloor({ inboxId: OWN_INBOX, floorLens })).resolves.toEqual({
        success: true,
      })
    }
    expect(floor.setInboxFloor).toHaveBeenCalledTimes(4)
  })
})
