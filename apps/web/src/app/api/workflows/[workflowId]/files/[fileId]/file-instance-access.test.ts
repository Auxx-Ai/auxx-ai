// apps/web/src/app/api/workflows/[workflowId]/files/[fileId]/file-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 30 §2.4, fourth instance of the class — the workflow-FILE REST route.
 *
 * `#1345` closed the hole on `/api/workflows/[workflowId]/run` and missed this
 * sibling. Both handlers here authenticated with `auth.api.getSession` and read
 * NO capabilities, scoping on `Workflow.organizationId` alone: GET handed back
 * `File.url` — the direct storage link — for any workflow's attachment, and
 * DELETE hard-deleted the `WorkflowFile` row, both for a workflow the caller
 * holds an explicit `none` restriction on.
 *
 * There is no tRPC procedure anywhere in the repo that touches `WorkflowFile`,
 * so the governing analogue is the workflow instance ladder itself:
 * `workflow.getById` → `assertViewInstance`, `workflow.update` →
 * `assertEditInstance`, `workflow.delete` → `assertAdminInstance`.
 *
 * Behavioral: the real handlers run with a REAL `CapabilitySet`. The DB reads
 * are the observed side effect — the gate must land ahead of them, so an
 * unauthorized caller cannot probe which files exist.
 */

const { getCapabilities, getSession, guardVersion, select, limit, del, deleteWhere, eq, and } =
  vi.hoisted(() => ({
    getCapabilities: vi.fn(),
    getSession: vi.fn(),
    guardVersion: vi.fn(),
    select: vi.fn(),
    limit: vi.fn(),
    del: vi.fn(),
    deleteWhere: vi.fn(),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  }))

vi.mock('@auxx/database', () => ({
  database: { select, delete: del },
  schema: {
    WorkflowFile: {
      id: 'WorkflowFile.id',
      fileId: 'WorkflowFile.fileId',
      workflowId: 'WorkflowFile.workflowId',
      nodeId: 'WorkflowFile.nodeId',
      uploadedAt: 'WorkflowFile.uploadedAt',
      expiresAt: 'WorkflowFile.expiresAt',
      uploadSource: 'WorkflowFile.uploadSource',
      metadata: 'WorkflowFile.metadata',
    },
    File: {
      id: 'File.id',
      name: 'File.name',
      mimeType: 'File.mimeType',
      size: 'File.size',
      url: 'File.url',
    },
    Workflow: { id: 'Workflow.id', organizationId: 'Workflow.organizationId' },
  },
}))

vi.mock('drizzle-orm', () => ({ and, eq }))

// The `@auxx/lib/permissions` barrel HANGS under vitest (get-capabilities,
// record-view-scope, overage-*) — stub it, keep the enums real via `/client`.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))
vi.mock('@auxx/lib/workflows', () => ({
  assertWorkflowVersionNotSystemOwned: guardVersion,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { GET, DELETE } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
/** A `Workflow.id` (a version/draft) — what this route's path segment carries. */
const VERSION_ID = 'wfv_cuid000000000000000000'
/** The version's parent `WorkflowApp.id` — what instance access keys on. */
const WF_ID = 'wf_cuid0000000000000000000'
/** The parent app a "belongs to another workflow" case resolves to. */
const OTHER_WF_ID = 'wf_othercuid0000000000000'
const FILE_ID = 'wff_cuid000000000000000000'

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** A real `CapabilitySet` holding `permission` on {@link WF_ID} via an explicit row. */
function capabilitiesFor(
  permission: ResourcePermission,
  {
    areaLevel = AREA_LEVEL_OF[permission],
    extraInstances = {},
  }: { areaLevel?: Level; extraInstances?: Record<string, ResourcePermission> } = {}
) {
  const instances = { [WF_ID]: permissionToRung(permission), ...extraInstances }
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.workflows]: areaLevel })),
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

/** A real `CapabilitySet` with NO `ResourceAccess` row anywhere — area level only. */
const areaOnly = (level: Level) =>
  new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.workflows]: level })),
    {},
    'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    {},
    new Set()
  )

function signedIn(
  capabilities: InstanceType<typeof CapabilitySet>,
  { isSuperAdmin = false }: { isSuperAdmin?: boolean } = {}
) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const request = () => ({ headers: new Headers() }) as never
const params = { params: Promise.resolve({ workflowId: VERSION_ID, fileId: FILE_ID }) }

const fileRow = {
  id: FILE_ID,
  fileId: 'file_cuid00000000000000000',
  workflowId: VERSION_ID,
  nodeId: 'node_1',
  uploadedAt: new Date('2026-07-27T00:00:00.000Z'),
  expiresAt: null,
  uploadSource: 'USER',
  metadata: {},
  // Mirrors the route's projection. `File` has no `url` column (and no `mimeType` —
  // the route selects `File.type` under the `mimeType` alias), so a `url` here would
  // be fabricating a column the real query can never return.
  file: {
    name: 'secret.pdf',
    mimeType: 'application/pdf',
    size: 1234,
  },
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  guardVersion.mockReset().mockResolvedValue(WF_ID)
  limit.mockReset().mockResolvedValue([fileRow])
  deleteWhere.mockReset().mockResolvedValue(undefined)
  del.mockReset().mockReturnValue({ where: deleteWhere })
  eq.mockClear()
  and.mockClear()
  // `.from()` → self-referential chain so both the 2-join GET query and the
  // 1-join DELETE query land on the same terminal `.limit()`.
  select.mockReset().mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    chain.innerJoin = () => chain
    chain.where = () => ({ limit })
    return { from: () => chain }
  })
})

describe('GET /api/workflows/[workflowId]/files/[fileId] — the §2.4 file hole', () => {
  it('401s without a session, before the guard, capabilities, or DB read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(guardVersion).not.toHaveBeenCalled()
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a member composing `workflows: None`, before the DB read', async () => {
    signedIn(areaOnly(Level.None))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // The gate must precede the read — otherwise file existence is still probeable.
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on the workflow', async () => {
    // THE case this fix exists for: the area is wide open (Full), and only the
    // per-instance `none` row stands between the caller and `File.url`. Before
    // the fix this member got the signed storage link.
    signedIn(capabilitiesFor(ResourcePermission.none, { areaLevel: Level.Full }))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
  })

  it('returns the file for a member holding instance `view`', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(select).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toMatchObject({
      file: { filename: 'secret.pdf', mimeType: 'application/pdf', size: 1234 },
    })
  })

  it('returns the file for a row-less workflow at the area Read rung (baselineAtCreate: false)', async () => {
    // Workflows are org-shared by default (plan 30 §3): with no `ResourceAccess`
    // row anywhere, the absent-row fallback IS the area level.
    signedIn(areaOnly(Level.Read))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('gates on the PARENT app the version resolves to, not the path id', async () => {
    // `[workflowId]` is a `Workflow.id` (a VERSION); instance access keys on the
    // parent `WorkflowApp.id` the guard hands back. A member who administers
    // WF_ID must still be refused a version whose parent they're restricted from.
    signedIn(
      capabilitiesFor(ResourcePermission.admin, {
        extraInstances: { [OTHER_WF_ID]: ResourcePermission.none },
      })
    )
    guardVersion.mockResolvedValueOnce(OTHER_WF_ID)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
  })

  it('404s an unknown version before any capability read', async () => {
    // The guard is org-scoped, so another org's version id is `undefined` here
    // too — identical to a version that never existed. Not probeable across orgs.
    signedIn(capabilitiesFor(ResourcePermission.admin))
    guardVersion.mockResolvedValueOnce(undefined)
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a system-owned workflow (the guard throws) ahead of the capability read', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    guardVersion.mockRejectedValueOnce(new Error('system-owned'))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('lets super admins read system-owned workflows (allowSuperAdminRead)', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin), { isSuperAdmin: true })
    await GET(request(), params)
    expect(guardVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isSuperAdmin: true, allowSuperAdminRead: true })
    )
  })

  it('404s an absent file for an authorized member', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    limit.mockResolvedValueOnce([])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/workflows/[workflowId]/files/[fileId] — detaching a file', () => {
  it('401s without a session, before the guard or any DB access', async () => {
    getSession.mockResolvedValue(null)
    const res = await DELETE(request(), params)
    expect(res.status).toBe(401)
    expect(guardVersion).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('403s a member composing `workflows: None`, before the DB read', async () => {
    signedIn(areaOnly(Level.None))
    const res = await DELETE(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('403s an instance `view` holder — reading a workflow is not mutating it', async () => {
    // The rung boundary: `view` confers running, `edit` confers authoring.
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await DELETE(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on the workflow', async () => {
    signedIn(capabilitiesFor(ResourcePermission.none, { areaLevel: Level.Full }))
    const res = await DELETE(request(), params)
    expect(res.status).toBe(403)
    expect(del).not.toHaveBeenCalled()
  })

  it('deletes for an instance `edit` holder — NOT gated at admin', async () => {
    // Deliberately below `workflow.delete`'s `assertAdminInstance`: removing one
    // attached file is an authoring mutation of the version's content, the same
    // class as `workflow.update`'s draft-graph save.
    signedIn(capabilitiesFor(ResourcePermission.edit))
    const res = await DELETE(request(), params)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true })
    expect(select).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('deletes for a row-less workflow at the area Edit rung (baselineAtCreate: false)', async () => {
    signedIn(areaOnly(Level.Edit))
    const res = await DELETE(request(), params)
    expect(res.status).toBe(200)
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('gates on the PARENT app the version resolves to, not the path id', async () => {
    signedIn(
      capabilitiesFor(ResourcePermission.admin, {
        extraInstances: { [OTHER_WF_ID]: ResourcePermission.none },
      })
    )
    guardVersion.mockResolvedValueOnce(OTHER_WF_ID)
    const res = await DELETE(request(), params)
    expect(res.status).toBe(403)
    expect(del).not.toHaveBeenCalled()
  })

  it('404s an unknown version before any capability read', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    guardVersion.mockResolvedValueOnce(undefined)
    const res = await DELETE(request(), params)
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('403s a system-owned workflow (the guard throws) ahead of the capability read', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    guardVersion.mockRejectedValueOnce(new Error('system-owned'))
    const res = await DELETE(request(), params)
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('gives super admins NO read-only bypass on this write path', async () => {
    // `allowSuperAdminRead` is a debugging affordance for reads only — a
    // system-owned workflow must stay immutable through this guard.
    signedIn(capabilitiesFor(ResourcePermission.admin), { isSuperAdmin: true })
    await DELETE(request(), params)
    expect(guardVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isSuperAdmin: true, allowSuperAdminRead: false })
    )
  })

  it('stays a no-op when the file row is absent for an authorized member', async () => {
    signedIn(capabilitiesFor(ResourcePermission.edit))
    limit.mockResolvedValueOnce([])
    const res = await DELETE(request(), params)
    expect(res.status).toBe(200)
    expect(del).not.toHaveBeenCalled()
  })
})
