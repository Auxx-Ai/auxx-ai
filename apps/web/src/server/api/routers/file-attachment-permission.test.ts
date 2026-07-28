// apps/web/src/server/api/routers/file-attachment-permission.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two bare-`protectedProcedure` reads that made `filesView` decorative on
 * `fileRouter` — the tRPC half of the `api/files/download/[fileId]` hole
 * (`file-download-permission.test.ts`).
 *
 * - `getAttachmentPreviewRef` returned a LIVE presigned download ref for any
 *   `FolderFile` or `MediaAsset` id in the org. Gated here — but per SCOPE, not
 *   on one key: the Files drawer keeps `FeatureKey.files` + `filesView`, while
 *   the dataset document drawer authorizes against its parent dataset. A single
 *   `filesView` gate blocked no content (`document.getDownloadUrl` resolves the
 *   same bytes behind `assertViewInstance('dataset', …)`) and only broke the
 *   preview pane for a member scoped to datasets with `files` below Read.
 * - `resolveFileRefs` returns name/mimeType/size for any org file/asset id and
 *   is deliberately STILL open — see the last block for why.
 *
 * Behavioral: real middleware, real `PERMISSION_REGISTRY_MAP`, and a real
 * `CapabilitySet` doing every check. Only the DB-backed capability fetch and the
 * plan lookup are stubbed. The file-service calls are the observed side effect:
 * the gate must land ahead of them.
 */

const {
  getCapabilities,
  planGate,
  getFileDownloadRef,
  getAssetDownloadRef,
  createFileService,
  createMediaAssetService,
  dbSelect,
  dbWhere,
} = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  planGate: vi.fn(),
  getFileDownloadRef: vi.fn(),
  getAssetDownloadRef: vi.fn(),
  createFileService: vi.fn(),
  createMediaAssetService: vi.fn(),
  dbSelect: vi.fn(),
  dbWhere: vi.fn(),
}))

// The `@auxx/lib/permissions` barrel HANGS under vitest — stub it, but keep the
// registry REAL so `permissionProcedure`'s `featureKey` lookup is the real one.
vi.mock('@auxx/lib/permissions', async () => {
  const { PERMISSION_REGISTRY_MAP, PermissionKey } = await import(
    '@auxx/lib/permissions/capabilities/registry'
  )
  const { FeatureKey } = await import('@auxx/lib/permissions/types')
  return {
    FeatureKey,
    PERMISSION_REGISTRY_MAP,
    PermissionKey,
    getCapabilities,
    FeaturePermissionService: class {
      requireAccess(orgId: string, featureKey: string) {
        return planGate(orgId, featureKey)
      }
    },
  }
})

vi.mock('@auxx/lib/files', () => ({
  createFileService,
  createFilesystemService: vi.fn(),
  createMediaAssetService,
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: {
    MediaAsset: {
      id: 'MediaAsset.id',
      name: 'MediaAsset.name',
      mimeType: 'MediaAsset.mimeType',
      size: 'MediaAsset.size',
      organizationId: 'MediaAsset.organizationId',
      deletedAt: 'MediaAsset.deletedAt',
    },
    FolderFile: {
      id: 'FolderFile.id',
      name: 'FolderFile.name',
      mimeType: 'FolderFile.mimeType',
      size: 'FolderFile.size',
      organizationId: 'FolderFile.organizationId',
      deletedAt: 'FolderFile.deletedAt',
    },
    Document: {
      id: 'Document.id',
      datasetId: 'Document.datasetId',
      mediaAssetId: 'Document.mediaAssetId',
      organizationId: 'Document.organizationId',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ op: 'inArray', a, b })),
  isNull: vi.fn((a: unknown) => ({ op: 'isNull', a })),
}))

vi.mock('@auxx/lib/cache', () => ({ getOrgCache: vi.fn() }))
vi.mock('@auxx/lib/members', () => ({ isOwner: vi.fn() }))
vi.mock('@auxx/lib/utils/rate-limiter/redis-rate-limiter', () => ({
  RedisRateLimiter: class {
    acquire = vi.fn(async () => true)
  },
}))
vi.mock('~/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('~/server/bootstrap', () => ({ ensureWebAppInitialized: vi.fn() }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { ResourcePermission } = await import('@auxx/database/enums')
const { ForbiddenError } = await import('@auxx/lib/errors')
const { createCallerFactory } = await import('~/server/api/trpc')
const { fileRouter } = await import('./file')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const FILE_ID = 'fil_cuid000000000000000000000'
const ASSET_ID = 'ast_cuid000000000000000000000'
const DOC_ID = 'doc_cuid000000000000000000000'
const DATASET_ID = 'dst_cuid000000000000000000000'

const createCaller = createCallerFactory(fileRouter)

/** A real `CapabilitySet` composing the Files area at `level`. */
function capabilitiesAt(level: Level) {
  return new CapabilitySet(new Set(expandLevelsToKeys({ [Area.files]: level })), {}, 'USER', 'full')
}

/**
 * Member 1 from the repro: scoped to datasets, with Files deliberately closed.
 * `dataset` is `baselineAtCreate: false`, so with no explicit row the area level
 * IS the per-instance answer — `datasets: Read` ⇒ `view` on every dataset.
 * Pass `restrictedDatasetId` to add the explicit `none` row that denies one.
 */
function datasetScopedCapabilities(datasets: Level, opts: { restrictedDatasetId?: string } = {}) {
  const restricted = opts.restrictedDatasetId
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.datasets]: datasets, [Area.files]: Level.None })),
    {},
    'USER',
    'full',
    (id) => id,
    new Set(),
    (id) => id,
    restricted ? { [restricted]: ResourcePermission.none } : {},
    restricted ? new Set([restricted]) : new Set()
  )
}

/** A caller for a signed-in member holding `capabilities`. */
function callerFor(capabilities: InstanceType<typeof CapabilitySet>) {
  getCapabilities.mockResolvedValue(capabilities)
  return createCaller({
    session: { user: { id: USER_ID, defaultOrganizationId: ORG_ID } },
    db: { select: dbSelect },
    headers: new Headers(),
  } as never)
}

const downloadRef = {
  type: 'url' as const,
  url: 'https://s3.example/presigned',
  filename: 'contract.pdf',
  mimeType: 'application/pdf',
  size: 2048n,
  versionNumber: 1,
  expiresAt: new Date('2026-07-27T01:00:00.000Z'),
}

beforeEach(() => {
  getCapabilities.mockReset()
  planGate.mockReset().mockResolvedValue(undefined)
  getFileDownloadRef.mockReset().mockResolvedValue(downloadRef)
  getAssetDownloadRef.mockReset().mockResolvedValue({ ...downloadRef, filename: 'logo.png' })
  createFileService.mockReset().mockReturnValue({
    getDownloadRefForVersion: getFileDownloadRef,
  })
  createMediaAssetService.mockReset().mockReturnValue({
    getDownloadRefForVersion: getAssetDownloadRef,
  })
  dbWhere.mockReset().mockResolvedValue([])
  // `where()` is awaited directly by `resolveFileRefs` and `.limit(1)`-chained by
  // `assertDatasetDocumentAssetAccess`, so the fake must be both thenable and
  // chainable off the same call.
  dbSelect.mockReset().mockReturnValue({
    from: () => ({
      where: (...args: unknown[]) => {
        const rows = dbWhere(...args)
        return Object.assign(rows, { limit: () => rows })
      },
    }),
  })
})

/** Neither backing service may be constructed for a denied caller. */
function expectNoFileReads() {
  expect(createFileService).not.toHaveBeenCalled()
  expect(createMediaAssetService).not.toHaveBeenCalled()
}

describe('file.getAttachmentPreviewRef — the live-download-ref hole', () => {
  it('FORBIDDENs a member composing `files: None`, before the service call', async () => {
    // THE case this fix exists for: as a bare `protectedProcedure` this handed
    // any authenticated org member a presigned URL for any file id they guessed.
    const caller = callerFor(capabilitiesAt(Level.None))
    await expect(
      caller.getAttachmentPreviewRef({ type: 'file', id: FILE_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expectNoFileReads()
  })

  it('FORBIDDENs a `files: None` member on the asset branch too', async () => {
    const caller = callerFor(capabilitiesAt(Level.None))
    await expect(
      caller.getAttachmentPreviewRef({ type: 'asset', id: ASSET_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expectNoFileReads()
  })

  it('FORBIDDENs when the org plan lacks the files feature, before the service call', async () => {
    // The plan-AND survives the move off `permissionProcedure`: the `files` scope
    // runs `FeatureKey.files` by hand, exactly as the middleware did. Ordering vs
    // `getCapabilities` DID change — `capabilityProcedure` composes capabilities
    // in middleware, so that cached read now happens first. Nothing is authorized
    // by it; the assertion that matters is that no file is read.
    const caller = callerFor(capabilitiesAt(Level.Full))
    planGate.mockRejectedValue(new ForbiddenError('Files is not available on your plan.'))
    await expect(
      caller.getAttachmentPreviewRef({ type: 'file', id: FILE_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(planGate).toHaveBeenCalledWith(ORG_ID, 'files')
    expectNoFileReads()
  })

  it('returns the ref for a member holding `files: Read` (file branch)', async () => {
    const caller = callerFor(capabilitiesAt(Level.Read))
    const result = await caller.getAttachmentPreviewRef({ type: 'file', id: FILE_ID })
    expect(result).toEqual(downloadRef)
    expect(createFileService).toHaveBeenCalledWith(ORG_ID, USER_ID)
    expect(getFileDownloadRef).toHaveBeenCalledWith(FILE_ID, {
      version: 'current',
      disposition: 'inline',
    })
  })

  it('returns the ref for a member holding `files: Read` (asset branch)', async () => {
    const caller = callerFor(capabilitiesAt(Level.Read))
    const result = await caller.getAttachmentPreviewRef({
      type: 'asset',
      id: ASSET_ID,
      disposition: 'attachment',
    })
    expect(result).toMatchObject({ filename: 'logo.png' })
    expect(createMediaAssetService).toHaveBeenCalledWith(ORG_ID, USER_ID)
    expect(getAssetDownloadRef).toHaveBeenCalledWith(ASSET_ID, {
      version: 'current',
      disposition: 'attachment',
    })
    expect(createFileService).not.toHaveBeenCalled()
  })

  it('UNAUTHORIZEDs a caller with no session, before capabilities', async () => {
    const caller = createCaller({
      session: null,
      db: { select: dbSelect },
      headers: new Headers(),
    } as never)
    await expect(
      caller.getAttachmentPreviewRef({ type: 'file', id: FILE_ID })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(getCapabilities).not.toHaveBeenCalled()
    expectNoFileReads()
  })
})

describe('file.getAttachmentPreviewRef — the `datasetDocument` scope', () => {
  /** The document row `assertDatasetDocumentAssetAccess` resolves. */
  function documentRow(overrides: Record<string, unknown> = {}) {
    return [{ datasetId: DATASET_ID, mediaAssetId: ASSET_ID, ...overrides }]
  }

  it('serves a dataset-scoped member who holds NO files access — the repro', async () => {
    // Member 1: dataset access, `files` below Read. Under the old single
    // `filesView` gate this 403'd while `document.getDownloadUrl` served the
    // same bytes to the same member.
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    dbWhere.mockResolvedValue(documentRow())
    const result = await caller.getAttachmentPreviewRef({
      type: 'asset',
      id: ASSET_ID,
      scope: { kind: 'datasetDocument', documentId: DOC_ID },
    })
    expect(result).toMatchObject({ filename: 'logo.png' })
    expect(getAssetDownloadRef).toHaveBeenCalledWith(ASSET_ID, {
      version: 'current',
      disposition: 'inline',
    })
  })

  it('does NOT run the files plan gate on the dataset branch', async () => {
    // Matches `routers/document.ts`, which is `capabilityProcedure` throughout —
    // a dataset document must not be gated on the Files feature.
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    planGate.mockRejectedValue(new ForbiddenError('Files is not available on your plan.'))
    dbWhere.mockResolvedValue(documentRow())
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'asset',
        id: ASSET_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).resolves.toMatchObject({ filename: 'logo.png' })
    expect(planGate).not.toHaveBeenCalled()
  })

  it('FORBIDDENs a member with an explicit `none` row on the parent dataset', async () => {
    const caller = callerFor(
      datasetScopedCapabilities(Level.Read, { restrictedDatasetId: DATASET_ID })
    )
    dbWhere.mockResolvedValue(documentRow())
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'asset',
        id: ASSET_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expectNoFileReads()
  })

  it('FORBIDDENs a member composing `datasets: None`', async () => {
    const caller = callerFor(datasetScopedCapabilities(Level.None))
    dbWhere.mockResolvedValue(documentRow())
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'asset',
        id: ASSET_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expectNoFileReads()
  })

  it('NOT_FOUNDs a document id that is missing or in another org', async () => {
    // Resolution 404s before any capability is read, so a foreign-org id is
    // indistinguishable from one this member merely cannot see.
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    dbWhere.mockResolvedValue([])
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'asset',
        id: ASSET_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expectNoFileReads()
  })

  it('refuses an asset the named document does not own — the confused deputy', async () => {
    // THE check that makes the scope safe. Without it, view on any one dataset
    // would launder into a presigned URL for any asset in the org.
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    dbWhere.mockResolvedValue(documentRow({ mediaAssetId: 'ast_someone_elses_asset' }))
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'asset',
        id: ASSET_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expectNoFileReads()
  })

  it('refuses a document that has no media asset at all', async () => {
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    dbWhere.mockResolvedValue(documentRow({ mediaAssetId: null }))
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'asset',
        id: ASSET_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expectNoFileReads()
  })

  it('BAD_REQUESTs the `file` type under a dataset scope', async () => {
    // Dataset documents are asset-backed; a `FolderFile` id under this scope
    // would skip the ownership check entirely.
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    await expect(
      caller.getAttachmentPreviewRef({
        type: 'file',
        id: FILE_ID,
        scope: { kind: 'datasetDocument', documentId: DOC_ID },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expectNoFileReads()
  })

  it('defaults to the `files` scope when none is passed', async () => {
    // The Files drawer passes no scope, so the default must keep its old gate.
    const caller = callerFor(datasetScopedCapabilities(Level.Read))
    await expect(
      caller.getAttachmentPreviewRef({ type: 'asset', id: ASSET_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expectNoFileReads()
  })
})

describe('file.resolveFileRefs — STILL an open metadata read (deliberate)', () => {
  /**
   * Not moved to `permissionProcedure(filesView)` with its sibling, and this
   * test pins that so the gap is visible rather than forgotten.
   *
   * Every one of its four callers renders FILE **custom fields** or sequence
   * attachments — `fields/displays/display-file.tsx`,
   * `dynamic-table/utils/cell-renderers.tsx`,
   * `fields/inputs/hooks/use-field-file-upload.ts`,
   * `sequences/ui/detail/sequence-step-attachments.tsx`. NOT ONE is a Files-app
   * surface. Gating it on `filesView` would make the Files area decide whether
   * FILE field values render anywhere in the product, and `SEAT_CEILINGS.worker`
   * clamps `files` to `None` unliftably while granting `recordsLinked: Full` —
   * so a field seat could never resolve a FILE field on a record it is entitled
   * to read. That is a design decision (probably: scope resolution to refs
   * reachable from records the caller can read, which also closes the
   * enumeration hole more tightly), not a mechanical key swap.
   *
   * When that decision lands, this test should flip to a FORBIDDEN assertion.
   */
  it('still answers a member composing `files: None` (documents the open hole)', async () => {
    const caller = callerFor(capabilitiesAt(Level.None))
    dbWhere.mockResolvedValue([
      { id: FILE_ID, name: 'contract.pdf', mimeType: 'application/pdf', size: 2048 },
    ])
    const result = await caller.resolveFileRefs({ refs: [`file:${FILE_ID}`] })
    expect(result).toEqual([
      { ref: `file:${FILE_ID}`, name: 'contract.pdf', mimeType: 'application/pdf', size: 2048 },
    ])
  })

  it('UNAUTHORIZEDs a caller with no session', async () => {
    const caller = createCaller({
      session: null,
      db: { select: dbSelect },
      headers: new Headers(),
    } as never)
    await expect(caller.resolveFileRefs({ refs: [`file:${FILE_ID}`] })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})
