// apps/web/src/app/api/files/download/[fileId]/file-download-permission.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The raw-content sibling of the run-trace hole (`run-trace-instance-access.test.ts`).
 *
 * `GET /api/files/download/[fileId]` streamed file BYTES and `HEAD` returned
 * name/size/mimeType for any `FolderFile` or `MediaAsset` in the org, after
 * authenticating with `auth.api.getSession` alone and reading NO capabilities —
 * `FileService.get` scopes on organization + soft-delete only. Its tRPC sibling
 * `file.getDownloadInfo` is `permissionProcedure(PermissionKey.filesView)`, as
 * are all eight file reads on that router.
 *
 * Behavioral: `requirePermission` is stubbed only as far as its two collaborators
 * (the plan gate and the capability fetch) — the registry lookup that decides
 * whether the plan gate runs, and `CapabilitySet.assert` itself, are REAL. The
 * file-service calls are the observed side effect: the gate must land ahead of
 * them, so an unauthorized caller cannot even probe whether an id exists.
 */

const {
  getSession,
  getCapabilities,
  planGate,
  fileGet,
  fileGetContent,
  assetGet,
  assetGetContent,
  createFileService,
  MediaAssetService,
  createFileDownloadResponse,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCapabilities: vi.fn(),
  planGate: vi.fn(),
  fileGet: vi.fn(),
  fileGetContent: vi.fn(),
  assetGet: vi.fn(),
  assetGetContent: vi.fn(),
  createFileService: vi.fn(),
  MediaAssetService: vi.fn(),
  createFileDownloadResponse: vi.fn(),
}))

// The `@auxx/lib/permissions` barrel HANGS under vitest — stub it. The stub is a
// faithful transcription of `capabilities/require.ts`: registry lookup → plan
// gate (only when the key links a `featureKey`) → real `assert`.
vi.mock('@auxx/lib/permissions', async () => {
  const { PERMISSION_REGISTRY_MAP, PermissionKey } = await import(
    '@auxx/lib/permissions/capabilities/registry'
  )
  return {
    PermissionKey,
    requirePermission: async (userId: string, orgId: string, key: never) => {
      const meta = PERMISSION_REGISTRY_MAP.get(key)
      if (meta?.featureKey) await planGate(orgId, meta.featureKey)
      const caps = await getCapabilities(userId, orgId)
      caps.assert(key)
    },
  }
})

vi.mock('@auxx/lib/files/server', () => ({
  createFileService,
  MediaAssetService,
  createFileDownloadResponse,
  parseRangeHeader: vi.fn(() => null),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep paths on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { ForbiddenError } = await import('@auxx/lib/errors')
const { GET, HEAD } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const FILE_ID = 'fil_cuid000000000000000000000'
const ASSET_ID = 'ast_cuid000000000000000000000'

/** A real `CapabilitySet` composing the Files area at `level`. */
function capabilitiesAt(level: Level) {
  return new CapabilitySet(new Set(expandLevelsToKeys({ [Area.files]: level })), {}, 'USER', 'full')
}

function signedIn(capabilities: InstanceType<typeof CapabilitySet>) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const request = () => ({ headers: new Headers() }) as never
const params = (fileId: string) => ({ params: Promise.resolve({ fileId }) })

const fileRow = { id: FILE_ID, name: 'contract.pdf', mimeType: 'application/pdf', size: 2048 }
const assetRow = { id: ASSET_ID, name: 'logo.png', mimeType: 'image/png', size: 512 }

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  planGate.mockReset().mockResolvedValue(undefined)
  fileGet.mockReset().mockResolvedValue(fileRow)
  fileGetContent.mockReset().mockResolvedValue(Buffer.from('file-bytes'))
  assetGet.mockReset().mockResolvedValue(assetRow)
  assetGetContent.mockReset().mockResolvedValue(Buffer.from('asset-bytes'))
  createFileService.mockReset().mockReturnValue({ get: fileGet, getContent: fileGetContent })
  // A class, not an arrow — the route calls `new MediaAssetService(...)`, and an
  // arrow implementation is not constructible (biome also rewrites plain function
  // expressions back to arrows, so the class is what survives `lint:fix`).
  MediaAssetService.mockReset().mockImplementation(
    class {
      get = assetGet
      getContent = assetGetContent
    } as never
  )
  createFileDownloadResponse.mockReset().mockReturnValue({
    buffer: Buffer.from('file-bytes'),
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  })
})

/** Every read the handler could perform — none may run for a denied caller. */
function expectNoFileReads() {
  expect(createFileService).not.toHaveBeenCalled()
  expect(MediaAssetService).not.toHaveBeenCalled()
  expect(fileGet).not.toHaveBeenCalled()
  expect(assetGet).not.toHaveBeenCalled()
}

describe('GET /api/files/download/[fileId] — the raw-content hole', () => {
  it('401s without a session, before any capability or file read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expectNoFileReads()
  })

  it('400s a session with no default organization, before any capability read', async () => {
    getSession.mockResolvedValue({ user: { id: USER_ID } })
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(400)
    expect(getCapabilities).not.toHaveBeenCalled()
    expectNoFileReads()
  })

  it('403s a member composing `files: None`, before the file read', async () => {
    // THE case this fix exists for: an authenticated org member with no Files
    // access at all previously got the bytes.
    signedIn(capabilitiesAt(Level.None))
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(403)
    // The gate must precede the read — otherwise existence is still probeable.
    expectNoFileReads()
  })

  it('403s a `files: None` member on the `asset:` FileRef form too', async () => {
    signedIn(capabilitiesAt(Level.None))
    const res = await GET(request(), params(`asset:${ASSET_ID}`))
    expect(res.status).toBe(403)
    expectNoFileReads()
  })

  it('403s when the org plan lacks the files feature, before the file read', async () => {
    // `PermissionKey.filesView` links `FeatureKey.files`, so `requirePermission`
    // runs the plan gate FIRST — the same plan-AND `permissionProcedure` runs.
    signedIn(capabilitiesAt(Level.Full))
    planGate.mockRejectedValue(new ForbiddenError('Files is not available on your plan.'))
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(403)
    expect(planGate).toHaveBeenCalledWith(ORG_ID, 'files')
    expect(getCapabilities).not.toHaveBeenCalled()
    expectNoFileReads()
  })

  it('500s — not 403 — when the gate fails for a non-permission reason', async () => {
    // Only an `AuxxError` maps to its status; anything else is rethrown so a
    // genuine failure is not masked as a permission denial.
    signedIn(capabilitiesAt(Level.Full))
    planGate.mockRejectedValue(new Error('redis down'))
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(500)
    expectNoFileReads()
  })

  it('streams the bytes for a member holding `files: Read` (bare id form)', async () => {
    signedIn(capabilitiesAt(Level.Read))
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(200)
    expect(createFileService).toHaveBeenCalledWith(ORG_ID, USER_ID)
    expect(fileGet).toHaveBeenCalledWith(FILE_ID)
    expect(await res.text()).toBe('file-bytes')
  })

  it('streams the bytes for the `file:` FileRef form, unwrapping the prefix', async () => {
    signedIn(capabilitiesAt(Level.Read))
    const res = await GET(request(), params(`file:${FILE_ID}`))
    expect(res.status).toBe(200)
    expect(fileGet).toHaveBeenCalledWith(FILE_ID)
    expect(MediaAssetService).not.toHaveBeenCalled()
  })

  it('streams the bytes for the `asset:` FileRef form via MediaAssetService', async () => {
    signedIn(capabilitiesAt(Level.Read))
    const res = await GET(request(), params(`asset:${ASSET_ID}`))
    expect(res.status).toBe(200)
    expect(MediaAssetService).toHaveBeenCalledWith(ORG_ID, USER_ID)
    expect(assetGet).toHaveBeenCalledWith(ASSET_ID)
    expect(createFileService).not.toHaveBeenCalled()
  })

  it('404s an absent file for an authorized member', async () => {
    signedIn(capabilitiesAt(Level.Read))
    fileGet.mockResolvedValue(null)
    const res = await GET(request(), params(FILE_ID))
    expect(res.status).toBe(404)
    // No content read for a row we could not load.
    expect(fileGetContent).not.toHaveBeenCalled()
  })

  it('400s an empty file id before touching the session', async () => {
    signedIn(capabilitiesAt(Level.Read))
    const res = await GET(request(), params(''))
    expect(res.status).toBe(400)
    expectNoFileReads()
  })
})

describe('HEAD /api/files/download/[fileId] — the metadata half of the same hole', () => {
  it('401s without a session, before any capability or file read', async () => {
    getSession.mockResolvedValue(null)
    const res = await HEAD(request(), params(FILE_ID))
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expectNoFileReads()
  })

  it('403s a member composing `files: None`, before the file read', async () => {
    // HEAD leaks name/size/mimeType, so it needs the identical gate — a fix that
    // lands on GET alone still hands over the file inventory.
    signedIn(capabilitiesAt(Level.None))
    const res = await HEAD(request(), params(FILE_ID))
    expect(res.status).toBe(403)
    expectNoFileReads()
  })

  it('403s a `files: None` member on the `asset:` FileRef form too', async () => {
    signedIn(capabilitiesAt(Level.None))
    const res = await HEAD(request(), params(`asset:${ASSET_ID}`))
    expect(res.status).toBe(403)
    expectNoFileReads()
  })

  it('403s when the org plan lacks the files feature, before the file read', async () => {
    signedIn(capabilitiesAt(Level.Full))
    planGate.mockRejectedValue(new ForbiddenError('Files is not available on your plan.'))
    const res = await HEAD(request(), params(FILE_ID))
    expect(res.status).toBe(403)
    expectNoFileReads()
  })

  it('returns the metadata headers for a member holding `files: Read`', async () => {
    signedIn(capabilitiesAt(Level.Read))
    const res = await HEAD(request(), params(FILE_ID))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Length')).toBe('2048')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="contract.pdf"')
  })

  it('404s an absent file for an authorized member', async () => {
    signedIn(capabilitiesAt(Level.Read))
    fileGet.mockResolvedValue(null)
    const res = await HEAD(request(), params(FILE_ID))
    expect(res.status).toBe(404)
  })
})
