// apps/web/src/app/api/files/upload/sessions/route.ts

import {
  createStorageManager,
  createUploadSession,
  ensureProcessorsInitialized,
  ProcessorRegistry,
  patchUploadSession,
  UploadErrorHandler,
  uploadSessionRedis,
} from '@auxx/lib/files/server'
import type { EntityType, UploadInitConfig } from '@auxx/lib/files/types'
import { ENTITY_TYPES } from '@auxx/lib/files/types'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { isAuxxError } from '~/server/api/trpc'

const logger = createScopedLogger('api-presigned-upload-sessions')

/** The clock the upload session's timestamps and TTL floor are computed against. */
const now = () => new Date()

/**
 * Stable error codes for the `{ error, message }` body this route returns, keyed
 * by an `AuxxError`'s status. Keeps the 403 body byte-identical to what the
 * hand-rolled `files.manage` catch used to produce.
 */
const HTTP_ERROR_CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
}

/**
 * Request schema for creating presigned upload sessions
 */
const CreateSessionSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string(),
  expectedSize: z.number().positive(),
  // Must stay a subset of `ProviderId` — there is no 'Local' adapter, so accepting
  // it here only turned a 400 into a "No adapter available for provider" 500.
  provider: z.enum(['S3', 'GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE', 'BOX']).optional(),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

/**
 * Create new presigned upload session
 */
export async function POST(request: NextRequest) {
  let session: any = null
  try {
    session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.defaultOrganizationId) {
      return UploadErrorHandler.unauthorized('User session required')
    }

    const body = await request.json()
    let sessionRequest
    try {
      sessionRequest = CreateSessionSchema.parse(body)
    } catch (validationError) {
      return UploadErrorHandler.validationError('Invalid session request format', {
        validationErrors: validationError,
      })
    }

    // Layer-2 gate (doc 10 §0): file-library uploads require `files.manage` (Full).
    // Record attachments, dataset docs, visit-QC photos, avatars, etc. reach this
    // same transport but are gated by their own host surface — leave them on the
    // plan/quota gate only. The thrown `ForbiddenError` keeps its own 403 via the
    // `isAuxxError` mapping in the outer catch.
    if (sessionRequest.entityType === ENTITY_TYPES.FILE) {
      const { requirePermission, PermissionKey } = await import('@auxx/lib/permissions')
      await requirePermission(
        session.user.id,
        session.user.defaultOrganizationId,
        PermissionKey.filesManage
      )
    }

    // Storage limit check: verify org has capacity for this upload
    try {
      const { FeaturePermissionService } = await import('@auxx/lib/permissions')
      const { calculateStorageUsage } = await import('@auxx/lib/files/lifecycle/quota-cleanup')
      const featureService = new FeaturePermissionService()
      const storageLimit = await featureService.getLimit(
        session.user.defaultOrganizationId,
        'storageGbHard'
      )
      if (storageLimit !== null && storageLimit !== '+' && typeof storageLimit === 'number') {
        const storageLimitBytes = storageLimit * 1024 * 1024 * 1024
        const quota = await calculateStorageUsage(session.user.defaultOrganizationId)
        const projectedUsage = quota.totalUsed + sessionRequest.expectedSize
        if (projectedUsage > storageLimitBytes) {
          const currentGb = Math.round((quota.totalUsed / (1024 * 1024 * 1024)) * 100) / 100
          return NextResponse.json(
            {
              error: 'USAGE_LIMIT',
              message: `You have reached your storage limit. Usage: ${currentGb}GB/${storageLimit}GB. Upgrade your plan for more storage.`,
              details: {
                metric: 'storageGb',
                current: String(currentGb),
                limit: String(storageLimit),
                upgradeRequired: 'true',
              },
            },
            { status: 403 }
          )
        }
      }
    } catch (storageCheckError) {
      // Fail open — allow the upload if storage check fails. Logged at `error`
      // on purpose: a silently failing billing gate has to be alertable.
      logger.error('Storage limit check failed (fail-open)', {
        error:
          storageCheckError instanceof Error
            ? storageCheckError.message
            : String(storageCheckError),
      })
    }

    // ============= NEW SIMPLIFIED THREE-STEP FLOW =============

    // Ensure processors are initialized before using the registry
    ensureProcessorsInitialized()

    // Step 1: EntityType directly determines processor (no complex mapping)
    const processor = ProcessorRegistry.getForEntityType(
      sessionRequest.entityType as EntityType,
      session.user.defaultOrganizationId
    )

    // Step 2: Processor creates unified config with policy and upload plan
    const init: UploadInitConfig = {
      organizationId: session.user.defaultOrganizationId,
      userId: session.user.id,
      fileName: sessionRequest.fileName,
      mimeType: sessionRequest.mimeType,
      expectedSize: sessionRequest.expectedSize,
      entityType: sessionRequest.entityType as EntityType, // Direct usage
      entityId: sessionRequest.entityId,
      provider: sessionRequest.provider,
      metadata: sessionRequest.metadata,
    }
    const { config, warnings } = await processor.processConfig(init)

    // Step 3: Create session from config and generate presigned URL with policy enforcement
    const redis = await uploadSessionRedis()
    const uploadSession = await createUploadSession(redis, config, now)
    const storageManager = createStorageManager(session.user.defaultOrganizationId)

    if (config.uploadPlan.strategy === 'single') {
      // Single-part presigned upload with policy enforcement
      const presigned = await storageManager.generatePresignedUploadUrl({
        ...config,
        metadata: { sessionId: uploadSession.id },
      })

      const uploadMethod = presigned.method || 'PUT'

      await patchUploadSession(
        redis,
        uploadSession.id,
        { presignedUrl: presigned.url, presignedFields: presigned.fields, uploadMethod },
        now
      )

      return NextResponse.json({
        sessionId: uploadSession.id,
        uploadMethod: 'single',
        uploadType: uploadMethod,
        presignedUrl: presigned.url,
        presignedFields: uploadMethod === 'POST' ? presigned.fields : undefined,
        storageKey: uploadSession.storageKey,
        expiresAt: uploadSession.expiresAt.toISOString(),
        warnings,
      })
    } else {
      // Multipart upload with policy enforcement
      const multipart = await storageManager.startMultipartUploadFromConfig({
        ...config,
        metadata: { sessionId: uploadSession.id },
      })

      // `partPresignEndpoint` is not part of the persisted session — the client
      // reads it off the response body below, so persisting it was a no-op.
      await patchUploadSession(
        redis,
        uploadSession.id,
        { uploadId: multipart.uploadId, uploadMethod: 'PUT' },
        now
      )

      return NextResponse.json({
        sessionId: uploadSession.id,
        uploadMethod: 'multipart',
        uploadId: multipart.uploadId,
        partPresignEndpoint: `/api/files/upload/${uploadSession.id}/parts`,
        storageKey: uploadSession.storageKey,
        expiresAt: uploadSession.expiresAt.toISOString(),
        warnings,
      })
    }
  } catch (error) {
    logger.error('Failed to create upload session', { error })

    // Raw App Router handler — there is no `auxxErrorMiddleware` here, so an
    // AuxxError's own status has to be applied by hand or `handleUploadError`
    // flattens it to a message-string-classified 500. `ProcessorRegistry`
    // (unregistered entity type) and `requirePermission` both throw one.
    if (isAuxxError(error)) {
      return NextResponse.json(
        { error: HTTP_ERROR_CODE_BY_STATUS[error.statusCode] ?? 'ERROR', message: error.message },
        { status: error.statusCode }
      )
    }

    // Generate a temporary session ID for error tracking
    const tempSessionId = `temp-${Date.now()}`
    return await UploadErrorHandler.handleUploadError(error, tempSessionId, 'session-creation', {
      hasUser: !!session?.user,
    })
  }
}
