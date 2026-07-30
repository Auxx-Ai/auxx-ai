// apps/web/src/server/api/routers/resource-access-instance-baseline.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { ResourceGranteeType, type ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROOT } from '../../../test/app-root'

/**
 * Plan 24 §B.4 — the **instance baseline picker round-trip** at the router that
 * owns the write. Every sharing surface (share card, share dialog, and the new
 * per-instance rows nested in the permission grids) funnels through
 * `resourceAccess.grantInstance`; picking **Restricted** on an instance row is
 * exactly `grantInstance({ granteeType: 'role', granteeId: 'org_member',
 * rung: 'none' })`.
 *
 * What these pin:
 *  - `none` survives the router untouched onto `grantInstanceAccess` (an
 *    `undefined`/dropped permission would render as "inherit" and make Restricted
 *    unreachable — the doc 16 §10 bug class);
 *  - `none` is refused for non-instance-access (mail) targets;
 *  - `authorizeInstanceTarget` really gates on `canAdminInstance` for the exact
 *    instance (§B.2.7): an instance-`edit` holder cannot re-share, and no write
 *    happens when it throws.
 *
 * `getCapabilities` is stubbed to return a **real** {@link CapabilitySet}, so the
 * authorization decision is the shipped one, not a boolean fake.
 */

const { getCapabilities, resourceAccess, isAdminOrOwner, recordAuditFromCtx } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  resourceAccess: {
    grantInstanceAccess: vi.fn(async () => undefined),
    setInstanceAccess: vi.fn(async () => undefined),
    revokeInstanceAccess: vi.fn(async () => true),
    grantTypeAccess: vi.fn(async () => undefined),
    setTypeAccess: vi.fn(async () => undefined),
    revokeTypeAccess: vi.fn(async () => true),
    getInstanceAccess: vi.fn(async () => []),
    getTypeAccess: vi.fn(async () => []),
    getAllInstanceAccess: vi.fn(async () => []),
    getAllTypeAccess: vi.fn(async () => []),
    assertCanManageMailSharing: vi.fn(async () => undefined),
    assertCanManageMailTypeAccess: vi.fn(async () => undefined),
    assertMailSharingFeature: vi.fn(async () => undefined),
  },
  isAdminOrOwner: vi.fn(async () => false),
  recordAuditFromCtx: vi.fn(async () => undefined),
}))

// `isMailSharingDef` + `ORG_MEMBER_GRANTEE_ID` are kept REAL: since plan v3/03 §7.1
// the predicate decides which of THREE lanes a target takes (instance-access /
// mail guard / record `assertEditEntity`), so a blanket `() => false` stub would
// route `contact:<id>` into the record lane and assert the wrong authority.
vi.mock('@auxx/lib/resource-access', async () => {
  const defs = await import('@auxx/lib/resource-access/mail-sharing-defs')
  return {
    ...resourceAccess,
    isMailSharingDef: defs.isMailSharingDef,
    ORG_MEMBER_GRANTEE_ID: 'org_member',
  }
})
vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('@auxx/lib/cache', () => ({
  // `grantee-schema.ts` (kept real — it decides which grantee kinds are legal)
  getCachedPermissionProfiles: vi.fn(async () => []),
  // Feeds `canonicalMailRecordId`'s def→slug resolver (plan 40 §5.1). Empty is
  // right here: these targets are already slug- or CUID-canonical.
  getCachedResources: vi.fn(async () => []),
}))

// The permissions barrel reaches redis/db at import time and hangs under vitest.
// Re-export the REAL instance-access registry (it decides whether `none` is legal
// for a target) and stub only the capability resolution.
vi.mock('@auxx/lib/permissions', async () => {
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  const resolve = await import('@auxx/lib/permissions/capabilities/resolve-capability-inputs')
  const types = await import('@auxx/lib/permissions/types')
  return {
    ...instanceAccess,
    buildDefIdToSlug: resolve.buildDefIdToSlug,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = vi.fn(async () => undefined)
    },
    getCapabilities,
  }
})

vi.mock('../trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, protectedProcedure: t.procedure }
})

// Deep path on purpose — see the note in `segment-instance-access.test.ts`.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { resourceAccessRouter } = await import('./resourceAccess')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const DATASET_ID = 'dset_cuid00000000000000000000'
const DATASET_RECORD_ID = `dataset:${DATASET_ID}`
const CONTACT_RECORD_ID = 'contact:cont_cuid0000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to a status). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const BAD_REQUEST = { cause: { name: 'BadRequestError', statusCode: 400 } }

/** The workspace-baseline marker row the instance pickers write through. */
const WORKSPACE_BASELINE = {
  granteeType: ResourceGranteeType.role,
  granteeId: 'org_member',
} as const

/** A real `CapabilitySet` holding `permission` on {@link DATASET_ID}. */
function capabilitiesFor(permission: ResourcePermission) {
  const areaLevel = {
    ['none']: Level.None,
    ['read']: Level.Read,
    ['edit']: Level.Edit,
    ['admin']: Level.Full,
  }[permission]
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.datasets]: areaLevel })),
    {},
    'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    { [DATASET_ID]: permission },
    new Set([DATASET_ID])
  )
}

const caller = resourceAccessRouter.createCaller({
  db: {},
  headers: new Headers(),
  session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
} as any)

beforeEach(() => {
  for (const fn of Object.values(resourceAccess)) fn.mockClear()
  isAdminOrOwner.mockResolvedValue(false)
  getCapabilities.mockResolvedValue(capabilitiesFor('admin'))
})

describe('grantInstance — the Restricted baseline round-trip (plan 24 §B.4)', () => {
  it('writes permission `none` verbatim for the workspace-baseline row', async () => {
    await expect(
      caller.grantInstance({
        recordId: DATASET_RECORD_ID,
        ...WORKSPACE_BASELINE,
        rung: 'none',
      })
    ).resolves.toEqual({ success: true })

    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledTimes(1)
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
      expect.objectContaining({
        recordId: DATASET_RECORD_ID,
        granteeType: 'role',
        granteeId: 'org_member',
        // `undefined` here would read back as "inherit" and Restricted would be
        // unreachable from the picker.
        rung: 'none',
      })
    )
  })

  it('records the lockdown in the audit log as a security event', async () => {
    await caller.grantInstance({
      recordId: DATASET_RECORD_ID,
      ...WORKSPACE_BASELINE,
      rung: 'none',
    })
    expect(recordAuditFromCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'permission.granted',
        metadata: expect.objectContaining({ scope: 'instance', rung: 'none' }),
      })
    )
  })

  it('carries the raise rungs through unchanged too (read/edit/admin)', async () => {
    for (const rung of ['read', 'edit', 'admin'] as const) {
      resourceAccess.grantInstanceAccess.mockClear()
      await caller.grantInstance({
        recordId: DATASET_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
        rung,
      })
      expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rung })
      )
    }
  })

  it('refuses `none` on a mail target — it is an instance-access-only marker', async () => {
    await expect(
      caller.grantInstance({
        recordId: CONTACT_RECORD_ID,
        ...WORKSPACE_BASELINE,
        rung: 'none',
      })
    ).rejects.toMatchObject(BAD_REQUEST)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })
})

describe('grantInstance — authorizeInstanceTarget gates on THIS instance (§B.2.7)', () => {
  it('refuses a sharer who only holds edit on the dataset', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor('edit'))

    await expect(
      caller.grantInstance({
        recordId: DATASET_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
        rung: 'admin',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('refuses a sharer restricted out of the dataset entirely', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor('none'))

    await expect(
      caller.grantInstance({
        recordId: DATASET_RECORD_ID,
        ...WORKSPACE_BASELINE,
        rung: 'none',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('an instance admin never falls through to the mail-sharing authorizer', async () => {
    await caller.grantInstance({
      recordId: DATASET_RECORD_ID,
      granteeType: ResourceGranteeType.group,
      granteeId: 'grp_sales',
      rung: 'read',
    })
    // The AUTHORIZER is skipped — that is the claim. The Enterprise plan gate is
    // NOT part of it: since plan 40 phase 3 `assertMailSharingFeature` runs on its
    // own line regardless of which authorizer answered, because `inbox` joining
    // `INSTANCE_ACCESS_RESOURCES` would otherwise have taken the mail plan gate
    // down with the guard's `inbox` arm (plan 40 §2/§5.3). It is a documented
    // no-op for every non-mail def, so a dataset target is unaffected.
    expect(resourceAccess.assertCanManageMailSharing).not.toHaveBeenCalled()
    expect(resourceAccess.assertMailSharingFeature).toHaveBeenCalledWith(
      expect.anything(),
      DATASET_RECORD_ID,
      [expect.objectContaining({ rung: 'read' })]
    )
  })

  it('a mail target still goes through the mail authorizer, not the capability gate', async () => {
    await caller.grantInstance({
      recordId: CONTACT_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'read',
    })
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(resourceAccess.assertCanManageMailSharing).toHaveBeenCalledTimes(1)
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledTimes(1)
  })

  it('revokeInstance is gated the same way — an edit holder cannot un-share', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor('edit'))

    await expect(
      caller.revokeInstance({
        recordId: DATASET_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.revokeInstanceAccess).not.toHaveBeenCalled()
  })
})

/**
 * `setInstance` (the replace-all path) deliberately does NOT accept `none`, so
 * Restricted can only be expressed through `grantInstance`. Pin the input schema
 * in source — a `none` sneaking into that enum would give the picker a second,
 * unaudited lockdown path.
 */
describe('resourceAccess — structural invariants', () => {
  const src = fs.readFileSync(
    path.resolve(APP_ROOT, 'src/server/api/routers/resourceAccess.ts'),
    'utf8'
  )

  it('setInstance accepts no `none` rung — Restricted funnels through grantInstance', () => {
    const from = src.indexOf('setInstance: protectedProcedure')
    const to = src.indexOf('.mutation(', from)
    const inputBlock = src.slice(from, to)
    // Post-P3b the input is ONE `rung` field (plan v3/03 §3), and the
    // replace-all mutations use `grantRungSchema` — the ladder minus `none`.
    expect(inputBlock).toContain('rung: grantRungSchema')
    expect(inputBlock).not.toContain("'none'")
  })

  it('every instance write authorizes through authorizeInstanceTarget', () => {
    for (const [proc, libCall] of [
      ['grantInstance:', 'grantInstanceAccess('],
      ['setInstance:', 'setInstanceAccess('],
      ['revokeInstance:', 'revokeInstanceAccess('],
    ] as const) {
      const from = src.indexOf(proc)
      const to = src.indexOf(libCall, from)
      expect(src.slice(from, to)).toContain('authorizeInstanceTarget(ctx')
    }
  })
})
