// apps/web/src/app/api/files/upload/[sessionId]/upload-session-auth.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `complete` and `parts` called `auth.api.getSession` NOWHERE
 * (`docs/files-upload-architecture-guide.md` §11.4, plan §1.2). The upload
 * session nanoid was the only credential, so anyone holding one could finish
 * someone else's upload or mint presigned `UploadPart` URLs for arbitrary part
 * numbers.
 *
 * These assert the three cases `authorizeUploadSession` distinguishes, plus the
 * ORDER: the auth check runs before Redis is touched, so an unauthenticated
 * caller cannot use the 404-vs-403 split to probe for live session ids.
 */

const {
  getSession,
  getUploadSession,
  touchUploadSession,
  failUploadSession,
  completeUpload,
  presignPart,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUploadSession: vi.fn(),
  touchUploadSession: vi.fn(),
  failUploadSession: vi.fn(),
  completeUpload: vi.fn(async () => ({ isErr: () => false, value: {} })),
  presignPart: vi.fn(async () => ({ isErr: () => false, value: { url: 'https://s3/part' } })),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))
vi.mock('@auxx/database', async () => (await import('~/test/database-mock')).mockAuxxDatabase())
// The `@auxx/lib/files/server` barrel drags in the AWS SDK and the processor
// registry; none of it is reachable before the gate, which is the point.
vi.mock('@auxx/lib/files/server', () => ({
  uploadSessionRedis: vi.fn(async () => ({})),
  getUploadSession,
  touchUploadSession,
  failUploadSession,
  completeUpload,
  presignPart,
  createS3StoragePort: vi.fn(() => ({})),
  createProductionQueuePort: vi.fn(() => ({})),
  createProductionCachePort: vi.fn(() => ({})),
  uploadErrorResponse: vi.fn(() => new Response('{}', { status: 500 })),
  uploadValidationError: vi.fn(() => new Response('{}', { status: 400 })),
}))

const { POST: completePost } = await import('./complete/route')
const { POST: partsPost } = await import('./parts/route')

const ORG_ID = 'org_cuid000000000000000000000'
const OTHER_ORG_ID = 'org_cuid111111111111111111111'
const USER_ID = 'usr_cuid000000000000000000000'
const OTHER_USER_ID = 'usr_cuid111111111111111111111'
const SESSION_ID = 'sess_nanoid_000000000000'

const params = { params: Promise.resolve({ sessionId: SESSION_ID }) }

function signedInAs(userId: string | null, organizationId: string | null = ORG_ID) {
  getSession.mockResolvedValue(
    userId ? { user: { id: userId, defaultOrganizationId: organizationId } } : null
  )
}

/** A live multipart session owned by `USER_ID` in `ORG_ID`. */
function uploadSessionOwnedBy(userId: string, organizationId: string) {
  getUploadSession.mockResolvedValue({
    version: 2,
    id: SESSION_ID,
    organizationId,
    userId,
    entityType: 'USER_PROFILE',
    fileName: 'avatar.png',
    mimeType: 'image/png',
    expectedSize: 1024,
    provider: 'S3',
    storageKey: 'org/avatar.png',
    isMultipart: true,
    uploadId: 'mpu-1',
    uploadMethod: 'PUT',
    status: 'uploading',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    ttlSec: 600,
    metadata: {},
    policy: {},
    uploadPlan: { strategy: 'multipart' },
    bucket: 'auxx-public',
    visibility: 'PUBLIC',
  })
}

const completeRequest = () =>
  new Request('http://localhost/api/files/upload/x/complete', {
    method: 'POST',
    body: JSON.stringify({ size: 1024, mimeType: 'image/png' }),
  }) as any

const partsRequest = () =>
  new Request('http://localhost/api/files/upload/x/parts', {
    method: 'POST',
    body: JSON.stringify({ partNumber: 1, size: 1024 }),
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  uploadSessionOwnedBy(USER_ID, ORG_ID)
})

describe.each([
  ['complete', (req: any) => completePost(req, params), completeRequest],
  ['parts', (req: any) => partsPost(req, params), partsRequest],
] as const)('%s — upload session authentication', (_name, call, request) => {
  it('401s with no session cookie, before the Redis session is read', async () => {
    signedInAs(null)

    const res = await call(request())

    expect(res.status).toBe(401)
    // Order matters: an unauthenticated caller must not be able to tell a live
    // session id from a dead one.
    expect(getUploadSession).not.toHaveBeenCalled()
  })

  it('401s for a signed-in user with no default organization', async () => {
    signedInAs(USER_ID, null)

    const res = await call(request())

    expect(res.status).toBe(401)
    expect(getUploadSession).not.toHaveBeenCalled()
  })

  it('403s when the session belongs to another user', async () => {
    signedInAs(OTHER_USER_ID)

    const res = await call(request())

    expect(res.status).toBe(403)
  })

  it('403s when the session belongs to another organization', async () => {
    signedInAs(USER_ID, OTHER_ORG_ID)

    const res = await call(request())

    expect(res.status).toBe(403)
  })

  it('404s an unknown session for an authenticated caller', async () => {
    signedInAs(USER_ID)
    getUploadSession.mockResolvedValue(null)

    const res = await call(request())

    expect(res.status).toBe(404)
  })
})

/**
 * PR 4e's deliberate change, and the follow-up PR 4c's retro asked for.
 *
 * `UploadErrorHandler.handleUploadError` wrote `status: 'failed'` for every error
 * it saw, and the parts route called it on both catch paths — so one failed part
 * presign killed a multipart upload that was otherwise fine. A part presign
 * mutates nothing, so there is no half-run state for the `failed` status to
 * protect a retry from; it only made `complete` refuse the session while leaving
 * the S3 multipart upload orphaned.
 */
describe('parts — a failed presign leaves the session usable', () => {
  it('returns the error without marking the session failed', async () => {
    signedInAs(USER_ID)
    presignPart.mockResolvedValueOnce({
      isErr: () => true,
      error: new Error('S3 threw'),
    } as never)

    const res = await partsPost(partsRequest(), params)

    expect(res.status).toBe(500)
    expect(failUploadSession).not.toHaveBeenCalled()
  })
})
