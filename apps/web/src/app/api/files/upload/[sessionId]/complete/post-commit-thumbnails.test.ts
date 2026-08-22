// apps/web/src/app/api/files/upload/[sessionId]/complete/post-commit-thumbnails.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan §1.3 / guide §10.3. Thumbnail presets used to be enqueued by the entity
 * PROCESSOR, which runs inside the route's still-open `db.transaction`. The
 * enqueue resolves the source asset on the GLOBAL `db`, so it read the
 * PRE-transaction `currentVersionId`: on a re-upload `avatar-64/128/256` found
 * the previous version's thumbnail, returned `ready`, and kept serving the OLD
 * image. Only the route's own `avatar-32` enqueue — the one already in Phase 3 —
 * ever saw the new version.
 *
 * So the whole preset set has to be enqueued from Phase 3, after the transaction
 * returns. `versionStore` models the global connection: it only advances when
 * `db.transaction` resolves.
 */

const {
  getSession,
  getUploadSession,
  updateSession,
  enqueueEnsureThumbnail,
  publishCompleted,
  getDownloadUrl,
  getWithRelations,
  invalidateUser,
  onCacheEvent,
  headByKey,
  createStorageLocation,
  buildExternalUrl,
  validateCompletedUpload,
  processorProcess,
  dbTransaction,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUploadSession: vi.fn(),
  updateSession: vi.fn(),
  enqueueEnsureThumbnail: vi.fn(),
  publishCompleted: vi.fn(),
  getDownloadUrl: vi.fn(async () => 'https://cdn.example/avatar.png'),
  getWithRelations: vi.fn(async () => ({ currentVersion: { storageLocation: { id: 'stl_1' } } })),
  invalidateUser: vi.fn(),
  onCacheEvent: vi.fn(),
  headByKey: vi.fn(async () => ({ size: 1024, mimeType: 'image/png', etagOrRev: 'etag-b' })),
  createStorageLocation: vi.fn(async () => ({ id: 'stl_cuid00000000000000000000' })),
  buildExternalUrl: vi.fn(async () => 'https://cdn.example/avatar.png'),
  validateCompletedUpload: vi.fn(),
  processorProcess: vi.fn(),
  dbTransaction: vi.fn(),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))
vi.mock('~/server/api/trpc', () => ({ isAuxxError: () => false }))
vi.mock('@auxx/database', () => ({ database: { transaction: dbTransaction }, schema: {} }))
vi.mock('@auxx/lib/dehydration', () => ({
  DehydrationService: class {
    invalidateUser = invalidateUser
  },
}))
vi.mock('@auxx/lib/cache', () => ({ onCacheEvent }))
vi.mock('@auxx/lib/files/server', () => ({
  SessionManager: { getSession: getUploadSession, updateSession, touchSession: vi.fn() },
  createStorageManager: () => ({
    headByKey,
    createStorageLocation,
    buildExternalUrl,
    deleteByKey: vi.fn(),
    completeMultipartUploadOnly: vi.fn(),
  }),
  ensureProcessorsInitialized: vi.fn(),
  ProcessorRegistry: {
    getForEntityType: () => ({ validateCompletedUpload, process: processorProcess }),
  },
  ProgressPublisher: { publishFailed: vi.fn(), publishCompleted },
  UploadErrorHandler: {
    handleUploadError: vi.fn(async () => new Response('{}', { status: 500 })),
    validationError: vi.fn(() => new Response('{}', { status: 400 })),
    sessionNotFound: vi.fn(() => new Response('{}', { status: 404 })),
    unauthorized: vi.fn(() => new Response('{}', { status: 401 })),
  },
  cleanupService: { scheduleCleanup: vi.fn() },
  MediaAssetService: class {
    getWithRelations = getWithRelations
    getDownloadUrl = getDownloadUrl
  },
  enqueueEnsureThumbnail,
}))

const { POST } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const ASSET_ID = 'ast_cuid000000000000000000000'
const SESSION_ID = 'sess_nanoid_000000000000'

const params = { params: Promise.resolve({ sessionId: SESSION_ID }) }

/** The global connection's view of the asset's current version. */
let versionStore = { current: 'ver_A' }
let committed = false
/** What each enqueue observed at the moment it ran. */
let observed: Array<{ preset?: string; version: string; committed: boolean; opts: any }> = []

function uploadSession(entityType: string) {
  getUploadSession.mockResolvedValue({
    version: 2,
    id: SESSION_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    entityType,
    entityId: entityType === 'USER_PROFILE' ? USER_ID : 'kb_cuid00000000000000000000',
    fileName: 'logo.png',
    mimeType: 'image/png',
    expectedSize: 1024,
    provider: 'S3',
    storageKey: 'org/logo.png',
    isMultipart: false,
    uploadMethod: 'PUT',
    status: 'uploading',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    ttlSec: 600,
    metadata: {},
    policy: {},
    uploadPlan: { strategy: 'single' },
    bucket: 'auxx-public',
    visibility: 'PUBLIC',
  })
}

const request = () =>
  new Request('http://localhost/api/files/upload/x/complete', {
    method: 'POST',
    body: JSON.stringify({ size: 1024, mimeType: 'image/png' }),
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  versionStore = { current: 'ver_A' }
  committed = false
  observed = []

  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })

  // The upload writes version B; the global connection only sees it at COMMIT.
  processorProcess.mockImplementation(async () => ({ assetId: ASSET_ID }))
  dbTransaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
    const out = await cb({})
    versionStore.current = 'ver_B'
    committed = true
    return out
  })

  enqueueEnsureThumbnail.mockImplementation(async ({ opts }: any) => {
    observed.push({ preset: opts.preset, version: versionStore.current, committed, opts })
    return { status: 'queued', jobId: `job-${opts.preset}` }
  })
})

describe('POST complete — thumbnail presets are enqueued post-commit', () => {
  it('enqueues all four avatar presets against the COMMITTED version', async () => {
    uploadSession('USER_PROFILE')

    const res = await POST(request(), params)
    expect(res.status).toBe(200)

    expect(observed.map((o) => o.preset).sort()).toEqual([
      'avatar-128',
      'avatar-256',
      'avatar-32',
      'avatar-64',
    ])
    for (const call of observed) {
      expect(call.committed).toBe(true)
      expect(call.version).toBe('ver_B')
    }
  })

  it('keeps `updateUser` on avatar-64 only', async () => {
    uploadSession('USER_PROFILE')

    await POST(request(), params)

    expect(observed.find((o) => o.preset === 'avatar-64')?.opts.updateUser).toBe(true)
    expect(observed.find((o) => o.preset === 'avatar-32')?.opts.updateUser).toBeUndefined()
  })

  it('enqueues both KB logo presets against the COMMITTED version', async () => {
    uploadSession('KNOWLEDGE_BASE')

    const res = await POST(request(), params)
    expect(res.status).toBe(200)

    expect(observed.map((o) => o.preset).sort()).toEqual(['kb-logo-lg', 'kb-logo-sm'])
    for (const call of observed) {
      expect(call.committed).toBe(true)
      expect(call.version).toBe('ver_B')
    }
  })

  it('enqueues nothing for an entity type with no presets', async () => {
    uploadSession('MESSAGE')

    await POST(request(), params)

    expect(observed).toEqual([])
  })
})
