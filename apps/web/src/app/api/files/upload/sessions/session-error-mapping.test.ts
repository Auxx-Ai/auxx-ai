// apps/web/src/app/api/files/upload/sessions/session-error-mapping.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `POST /api/files/upload/sessions` is a raw App Router handler, so no
 * `auxxErrorMiddleware` runs on it. `prepareUpload` surfaces a `BadRequestError`
 * for an entity type with no processor instead of silently defaulting to
 * `FileProcessor` (plan §1.7), and the explicit map in the route is what gives
 * that its own status.
 *
 * PR 4c deleted the substring classifier behind `handleUploadError`, so the
 * fallback path no longer *needs* this branch to keep an AuxxError's status —
 * but the branch stays, because it emits a DIFFERENT body:
 * `{ error: <code>, message }` rather than
 * `{ error: <message>, errorType, retryable, code }`. The `files.manage` 403
 * body must stay `{ error: 'FORBIDDEN', message }`, which is what the second
 * case below pins.
 *
 * PR 4e moved the orchestration into `prepareUpload`, so the route's failure
 * surface is now exactly "whatever `Result` came back", which is what these
 * cases drive.
 */

const { getSession, prepareUpload, requirePermission, calculateStorageUsage, getLimit, logger } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    prepareUpload: vi.fn(),
    requirePermission: vi.fn(),
    calculateStorageUsage: vi.fn(),
    getLimit: vi.fn(),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      with: vi.fn(),
    },
  }))

vi.mock('@auxx/logger', async () =>
  (await import('~/test/logger-mock')).mockAuxxLogger({ createScopedLogger: () => logger })
)
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))
vi.mock('@auxx/database', () => ({ database: { transaction: vi.fn() }, schema: {} }))

// Faithful to `~/server/api/trpc`'s exported guard; the `name` + `statusCode`
// branch there exists only for dual module copies, which the vitest source
// alias rules out.
vi.mock('~/server/api/trpc', async () => {
  const { AuxxError } = await import('@auxx/lib/errors')
  return { isAuxxError: (e: unknown) => e instanceof AuxxError }
})

vi.mock('@auxx/lib/files/server', () => ({
  prepareUpload,
  createS3StoragePort: vi.fn(() => ({})),
  uploadSessionRedis: vi.fn(async () => ({})),
  uploadErrorResponse: vi.fn(() => new Response('{}', { status: 500 })),
  uploadUnauthorizedError: vi.fn(() => new Response('{}', { status: 401 })),
  uploadValidationError: vi.fn(() => new Response('{}', { status: 400 })),
}))

vi.mock('@auxx/lib/permissions', () => ({
  requirePermission,
  PermissionKey: { filesManage: 'files.manage' },
  FeaturePermissionService: class {
    getLimit = getLimit
  },
}))
vi.mock('@auxx/lib/files/lifecycle/quota-cleanup', () => ({ calculateStorageUsage }))

const { BadRequestError, ForbiddenError } = await import('@auxx/lib/errors')
const { POST } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** `prepareUpload` returns a neverthrow `Result`; only these two members are read. */
const errResult = (error: unknown) => ({ isErr: () => true, error }) as never

const request = (entityType: string) =>
  new Request('http://localhost/api/files/upload/sessions', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'a.png',
      mimeType: 'image/png',
      expectedSize: 1024,
      entityType,
    }),
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })
  getLimit.mockResolvedValue(null)
  requirePermission.mockResolvedValue(undefined)
})

describe('POST sessions — AuxxError keeps its own status', () => {
  it('400s a BadRequestError from the upload preparation, not 500', async () => {
    prepareUpload.mockResolvedValue(
      errResult(new BadRequestError('No upload processor for entity type: visit_qc_item'))
    )

    const res = await POST(request('MESSAGE'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'No upload processor for entity type: visit_qc_item',
    })
  })

  it('keeps the 403 body shape for the folded `files.manage` gate', async () => {
    requirePermission.mockRejectedValue(new ForbiddenError('Missing permission: files.manage'))

    const res = await POST(request('FILE'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'FORBIDDEN',
      message: 'Missing permission: files.manage',
    })
    // The gate runs before any work is attempted.
    expect(prepareUpload).not.toHaveBeenCalled()
  })
})

describe('POST sessions — the storage quota gate', () => {
  it('logs at error, not warn, when the fail-open gate swallows a failure', async () => {
    getLimit.mockRejectedValue(new Error('feature service down'))
    prepareUpload.mockResolvedValue(errResult(new BadRequestError('stop here')))

    await POST(request('MESSAGE'))

    expect(logger.error).toHaveBeenCalledWith(
      'Storage limit check failed (fail-open)',
      expect.objectContaining({ error: 'feature service down' })
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('403s with the USAGE_LIMIT body the UI parses, before preparing anything', async () => {
    getLimit.mockResolvedValue(1)
    calculateStorageUsage.mockResolvedValue({ totalUsed: 2 * 1024 * 1024 * 1024 })

    const res = await POST(request('MESSAGE'))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: 'USAGE_LIMIT',
      details: { metric: 'storageGb', upgradeRequired: 'true' },
    })
    expect(prepareUpload).not.toHaveBeenCalled()
  })
})

describe('POST sessions — the success bodies', () => {
  it('emits the single-shot wire shape', async () => {
    prepareUpload.mockResolvedValue({
      isErr: () => false,
      value: {
        sessionId: 'sess_1',
        strategy: 'single',
        storageKey: 'org/a.png',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        warnings: [],
        httpMethod: 'PUT',
        presignedUrl: 'https://s3/upload',
      },
    } as never)

    const res = await POST(request('MESSAGE'))

    expect(await res.json()).toEqual({
      sessionId: 'sess_1',
      storageKey: 'org/a.png',
      expiresAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
      uploadMethod: 'single',
      uploadType: 'PUT',
      presignedUrl: 'https://s3/upload',
    })
  })

  it('emits the multipart wire shape, including the part endpoint', async () => {
    prepareUpload.mockResolvedValue({
      isErr: () => false,
      value: {
        sessionId: 'sess_2',
        strategy: 'multipart',
        storageKey: 'org/big.zip',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        warnings: [],
        uploadId: 'mpu-1',
      },
    } as never)

    const res = await POST(request('MESSAGE'))

    expect(await res.json()).toEqual({
      sessionId: 'sess_2',
      storageKey: 'org/big.zip',
      expiresAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
      uploadMethod: 'multipart',
      uploadId: 'mpu-1',
      partPresignEndpoint: '/api/files/upload/sess_2/parts',
    })
  })
})
