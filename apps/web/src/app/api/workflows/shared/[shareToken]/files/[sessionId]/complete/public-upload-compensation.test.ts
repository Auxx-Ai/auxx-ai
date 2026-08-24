// apps/web/src/app/api/workflows/shared/[shareToken]/files/[sessionId]/complete/public-upload-compensation.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The public workflow-share completion route and the bytes it used to leak.
 *
 * The browser PUTs to S3 against a presigned URL, so the object exists before
 * this route runs. Until this test's subject was fixed, every failure branch
 * returned a 500 having neither deleted the object nor enqueued a cleanup —
 * `docs/files-upload-architecture-guide.md` §12, checklist item 3.
 *
 * What is asserted here is the *policy*, not the mechanism: which branches call
 * `compensateUploadObject`, which deliberately do not, and that the call always
 * names the bucket the session recorded. `compensateUploadObject`'s own
 * behaviour (delete, then enqueue, never throw) is asserted against the real
 * implementation in `packages/lib/src/files/upload/__tests__/compensate.test.ts`.
 */

const {
  compensateUploadObject,
  createAssetWithVersion,
  createStorageLocation,
  getAssetDownloadRef,
  getSystemUserForActions,
  headByKey,
  getRedisData,
  deleteRedisData,
  transaction,
} = vi.hoisted(() => ({
  compensateUploadObject: vi.fn(async () => 'deleted'),
  createAssetWithVersion: vi.fn(),
  createStorageLocation: vi.fn(),
  getAssetDownloadRef: vi.fn(),
  getSystemUserForActions: vi.fn(),
  headByKey: vi.fn(),
  getRedisData: vi.fn(),
  deleteRedisData: vi.fn(async () => 1),
  transaction: vi.fn(),
}))

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({ database: { transaction } })
)
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('@auxx/redis', () => ({ getRedisData, deleteRedisData }))
vi.mock('@auxx/lib/users', () => ({
  SystemUserService: { getSystemUserForActions: getSystemUserForActions },
}))
vi.mock('@auxx/lib/files/server', () => ({
  compensateUploadObject,
  createAssetWithVersion,
  createProductionQueuePort: () => ({ queue: true }),
  createS3StoragePort: () => ({ storage: true }),
  createStorageManager: () => ({ headByKey, createStorageLocation }),
  getAssetDownloadRef,
}))
vi.mock('@auxx/services/workflow-share', () => ({
  verifyWorkflowPassport: async () => ({
    isErr: () => false,
    value: { shareToken: SHARE_TOKEN, endUserId: END_USER_ID },
  }),
}))

const SHARE_TOKEN = 'shr_token00000000000000'
const SESSION_ID = 'puf_cuid00000000000000000'
const END_USER_ID = 'eus_cuid00000000000000000'
const ORG_ID = 'org_cuid000000000000000000000'
const BUCKET = 'auxx-private-test'
const STORAGE_KEY = `public-workflow/${ORG_ID}/${SHARE_TOKEN}/${SESSION_ID}/report.pdf`

const { POST } = await import('./route')

const session = (overrides: Record<string, unknown> = {}) => ({
  storageKey: STORAGE_KEY,
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  organizationId: ORG_ID,
  endUserId: END_USER_ID,
  shareToken: SHARE_TOKEN,
  nodeId: 'n1',
  bucket: BUCKET,
  ...overrides,
})

/** Cast because only the headers matter here; nothing reads the `NextRequest` surface. */
const request = () =>
  new Request(`http://localhost/api/workflows/shared/${SHARE_TOKEN}/files/${SESSION_ID}/complete`, {
    method: 'POST',
    headers: { authorization: 'Bearer passport' },
  }) as never

const params = { params: Promise.resolve({ shareToken: SHARE_TOKEN, sessionId: SESSION_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  compensateUploadObject.mockResolvedValue('deleted')
  getRedisData.mockResolvedValue(session())
  headByKey.mockResolvedValue({ size: 1024, mimeType: 'application/pdf' })
  getSystemUserForActions.mockResolvedValue('usr_org_system0000000000')
  createStorageLocation.mockResolvedValue({ id: 'stl_cuid0000000000000000' })
  createAssetWithVersion.mockResolvedValue({
    isErr: () => false,
    value: {
      asset: { id: 'mda_cuid0000000000000000' },
      version: { id: 'mdv_cuid0000000000000000' },
    },
  })
  getAssetDownloadRef.mockResolvedValue({
    isErr: () => false,
    value: { type: 'url', url: 'https://example.test/report.pdf' },
  })
  // A stand-in transaction: runs the body, and propagates a throw the way a
  // rollback does.
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true }))
})

describe('failures that orphan the object compensate', () => {
  it('compensates when the persist transaction rolls back, naming the session bucket', async () => {
    transaction.mockRejectedValue(new Error('asset insert exploded'))

    const response = await POST(request(), params)

    expect(response.status).toBe(500)
    expect(compensateUploadObject).toHaveBeenCalledTimes(1)
    expect(compensateUploadObject.mock.calls[0]?.[1]).toMatchObject({
      provider: 'S3',
      bucket: BUCKET,
      key: STORAGE_KEY,
      organizationId: ORG_ID,
      sessionId: SESSION_ID,
    })
  })

  it('compensates when the asset write returns err, because that rolls back too', async () => {
    createAssetWithVersion.mockResolvedValue({
      isErr: () => true,
      error: new Error('no system user row'),
    })

    const response = await POST(request(), params)

    expect(response.status).toBe(500)
    expect(compensateUploadObject).toHaveBeenCalledTimes(1)
  })

  it('compensates when the organization has no system user', async () => {
    getSystemUserForActions.mockRejectedValue(new Error('no system user'))

    const response = await POST(request(), params)

    expect(response.status).toBe(500)
    expect(compensateUploadObject).toHaveBeenCalledTimes(1)
    expect(compensateUploadObject.mock.calls[0]?.[1]).toMatchObject({ bucket: BUCKET })
  })

  it('retires the Redis session it just compensated, so a retry cannot compensate twice', async () => {
    transaction.mockRejectedValue(new Error('asset insert exploded'))

    await POST(request(), params)

    expect(deleteRedisData).toHaveBeenCalledWith(`public-upload:${SESSION_ID}`, false)
  })
})

describe('failures that must NOT compensate', () => {
  it('leaves the object alone when the HEAD fails, because its existence is unconfirmed', async () => {
    headByKey.mockRejectedValue(new Error('NotFound'))

    const response = await POST(request(), params)

    expect(response.status).toBe(404)
    expect(compensateUploadObject).not.toHaveBeenCalled()
    // The session survives for the retry that can still commit those bytes.
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('refuses to act at all when the session recorded no bucket, rather than guessing one', async () => {
    getRedisData.mockResolvedValue(session({ bucket: '' }))

    const response = await POST(request(), params)

    expect(response.status).toBe(500)
    expect(compensateUploadObject).not.toHaveBeenCalled()
    expect(headByKey).not.toHaveBeenCalled()
  })

  it('does not compensate a committed upload whose download URL could not be signed', async () => {
    getAssetDownloadRef.mockRejectedValue(new Error('presign failed'))

    const response = await POST(request(), params)

    expect(response.status).toBe(200)
    expect(compensateUploadObject).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ assetId: 'mda_cuid0000000000000000' })
  })

  it('does not compensate the happy path', async () => {
    const response = await POST(request(), params)

    expect(response.status).toBe(200)
    expect(compensateUploadObject).not.toHaveBeenCalled()
    expect(createStorageLocation).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: BUCKET, externalId: STORAGE_KEY }),
      { tx: { tx: true } }
    )
  })
})
