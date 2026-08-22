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

const { getSession, getUploadSession, touchUploadSession, patchUploadSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUploadSession: vi.fn(),
  touchUploadSession: vi.fn(),
  patchUploadSession: vi.fn(),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))
vi.mock('~/server/api/trpc', () => ({ isAuxxError: () => false }))
vi.mock('@auxx/database', () => ({ database: { transaction: vi.fn() }, schema: {} }))
// The `@auxx/lib/files/server` barrel drags in the AWS SDK and the processor
// registry; none of it is reachable before the gate, which is the point.
vi.mock('@auxx/lib/files/server', () => ({
  uploadSessionRedis: vi.fn(async () => ({})),
  getUploadSession,
  touchUploadSession,
  patchUploadSession,
  createStorageManager: vi.fn(),
  ensureProcessorsInitialized: vi.fn(),
  ProcessorRegistry: { getForEntityType: vi.fn() },
  UploadErrorHandler: {
    handleUploadError: vi.fn(async () => new Response('{}', { status: 500 })),
    validationError: vi.fn(() => new Response('{}', { status: 400 })),
    sessionNotFound: vi.fn(() => new Response('{}', { status: 404 })),
    unauthorized: vi.fn(() => new Response('{}', { status: 401 })),
  },
  cleanupService: { scheduleCleanup: vi.fn() },
  MediaAssetService: vi.fn(),
  enqueueEnsureThumbnail: vi.fn(),
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
