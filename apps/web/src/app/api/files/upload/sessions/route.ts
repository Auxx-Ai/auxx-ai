// apps/web/src/app/api/files/upload/sessions/route.ts

import { database as db } from '@auxx/database'
import { ForbiddenError } from '@auxx/lib/errors'
import {
  createS3StoragePort,
  prepareUpload,
  uploadErrorResponse,
  uploadSessionRedis,
  uploadUnauthorizedError,
  uploadValidationError,
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
 * Create new presigned upload session.
 *
 * The route owns three things and nothing else (plan §4.7): authentication, the
 * two gates that must not live in lib, and the `Result` → `Response` translation.
 * Everything between — processor lookup, config, session creation, presigning —
 * is `prepareUpload`.
 *
 * **Why the two gates stay here.** `files.manage` is authorization, and
 * `packages/lib` performs zero access checks (`docs/lib-module-guide.md` §6). The
 * storage quota answers with a `{ error: 'USAGE_LIMIT', details }` body the UI
 * parses, which is not the generic upload-error shape lib produces.
 */
export async function POST(request: NextRequest) {
  let session: any = null
  try {
    session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.defaultOrganizationId) {
      return uploadUnauthorizedError('User session required')
    }

    const body = await request.json()
    let sessionRequest
    try {
      sessionRequest = CreateSessionSchema.parse(body)
    } catch (validationError) {
      return uploadValidationError('Invalid session request format', {
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

    // Uploading an avatar for someone *else* — in practice the synthetic user
    // behind an agent — requires org admin. This moved out of
    // `UserProfileProcessor.validateEntityAccess` in PR 4d: lib performs zero
    // access checks (`docs/lib-module-guide.md` §6), and the handler's
    // `validateEntity` now answers only the identity half (is the target a user
    // of this organization at all). It also used to throw a bare `Error`, which
    // the route reported as a 500; a refused upload is a 403.
    if (
      sessionRequest.entityType === ENTITY_TYPES.USER_PROFILE &&
      sessionRequest.entityId &&
      sessionRequest.entityId !== session.user.id
    ) {
      const { isAdminOrOwner } = await import('@auxx/lib/members')
      if (!(await isAdminOrOwner(session.user.defaultOrganizationId, session.user.id))) {
        throw new ForbiddenError('Admin required to update agent avatars')
      }
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
        const quota = await calculateStorageUsage({
          db,
          organizationId: session.user.defaultOrganizationId,
        })
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

    const organizationId: string = session.user.defaultOrganizationId
    const init: UploadInitConfig = {
      organizationId,
      userId: session.user.id,
      fileName: sessionRequest.fileName,
      mimeType: sessionRequest.mimeType,
      expectedSize: sessionRequest.expectedSize,
      entityType: sessionRequest.entityType as EntityType,
      entityId: sessionRequest.entityId,
      provider: sessionRequest.provider,
      metadata: sessionRequest.metadata,
    }

    const prepared = await prepareUpload(
      { db, organizationId },
      { storage: createS3StoragePort(organizationId), now, redis: await uploadSessionRedis() },
      init
    )

    if (prepared.isErr()) throw prepared.error

    const upload = prepared.value
    const common = {
      sessionId: upload.sessionId,
      storageKey: upload.storageKey,
      expiresAt: upload.expiresAt.toISOString(),
      warnings: upload.warnings,
    }

    // `uploadMethod` on the wire means the strategy; `uploadType` means the HTTP
    // verb. Both names are legacy and both are load-bearing for the browser
    // uploader, so the mapping happens here rather than being carried inward.
    return NextResponse.json(
      upload.strategy === 'single'
        ? {
            ...common,
            uploadMethod: 'single',
            uploadType: upload.httpMethod,
            presignedUrl: upload.presignedUrl,
            presignedFields: upload.presignedFields,
          }
        : {
            ...common,
            uploadMethod: 'multipart',
            uploadId: upload.uploadId,
            partPresignEndpoint: `/api/files/upload/${upload.sessionId}/parts`,
          }
    )
  } catch (error) {
    logger.error('Failed to create upload session', { error })

    // Raw App Router handler — there is no `auxxErrorMiddleware` here, so an
    // AuxxError's own status has to be applied by hand. This branch also owns a
    // DIFFERENT body shape from the one below (`{ error: <code>, message }`
    // rather than `{ error: <message>, errorType, retryable, code }`), which is
    // what `session-error-mapping.test.ts` pins for the `files.manage` 403.
    // `prepareUpload` (unregistered entity type) and `requirePermission` both
    // surface an AuxxError.
    if (isAuxxError(error)) {
      return NextResponse.json(
        { error: HTTP_ERROR_CODE_BY_STATUS[error.statusCode] ?? 'ERROR', message: error.message },
        { status: error.statusCode }
      )
    }

    // No session exists yet on this route, so there is nothing to mark failed.
    // This used to pass `temp-${Date.now()}` purely to fill a required parameter,
    // and the handler string-matched the prefix back off to skip the Redis write.
    return uploadErrorResponse(error, {
      operation: 'session-creation',
      context: { hasUser: !!session?.user },
    })
  }
}
