// apps/web/src/app/api/files/upload/sessions/session-error-mapping.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `POST /api/files/upload/sessions` is a raw App Router handler, so no
 * `auxxErrorMiddleware` runs on it. `ProcessorRegistry.getForEntityType` now
 * throws `BadRequestError` for an unregistered entity type instead of silently
 * defaulting to `FileProcessor` (plan §1.7), and without an explicit map that
 * lands in `UploadErrorHandler.handleUploadError`, which classifies status by
 * SUBSTRING MATCH on the message — a generic 500.
 *
 * Also covers the fold of the hand-rolled `files.manage` catch into the same
 * mapping: the 403 body must stay `{ error: 'FORBIDDEN', message }`.
 */

const { getSession, getForEntityType, requirePermission, calculateStorageUsage, getLimit, logger } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    getForEntityType: vi.fn(),
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

// Faithful to `~/server/api/trpc`'s exported guard; the `name` + `statusCode`
// branch there exists only for dual module copies, which the vitest source
// alias rules out.
vi.mock('~/server/api/trpc', async () => {
  const { AuxxError } = await import('@auxx/lib/errors')
  return { isAuxxError: (e: unknown) => e instanceof AuxxError }
})

vi.mock('@auxx/lib/files/server', () => ({
  createStorageManager: () => ({
    generatePresignedUploadUrl: vi.fn(),
    startMultipartUploadFromConfig: vi.fn(),
  }),
  ensureProcessorsInitialized: vi.fn(),
  ProcessorRegistry: { getForEntityType },
  SessionManager: { createSessionFromConfig: vi.fn(), updateSession: vi.fn() },
  UploadErrorHandler: {
    handleUploadError: vi.fn(async () => new Response('{}', { status: 500 })),
    validationError: vi.fn(() => new Response('{}', { status: 400 })),
    unauthorized: vi.fn(() => new Response('{}', { status: 401 })),
  },
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
  it('400s a BadRequestError from the processor registry, not 500', async () => {
    getForEntityType.mockImplementation(() => {
      throw new BadRequestError('No upload processor for entity type: visit_qc_item')
    })

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
  })
})

describe('POST sessions — the storage quota gate', () => {
  it('logs at error, not warn, when the fail-open gate swallows a failure', async () => {
    getLimit.mockRejectedValue(new Error('feature service down'))
    getForEntityType.mockImplementation(() => {
      throw new BadRequestError('stop here')
    })

    await POST(request('MESSAGE'))

    expect(logger.error).toHaveBeenCalledWith(
      'Storage limit check failed (fail-open)',
      expect.objectContaining({ error: 'feature service down' })
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
