// apps/web/src/app/api/files/upload/sessions/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { createScopedLogger } from '@auxx/logger'
import {
  SessionManager,
  ProcessorRegistry,
  ensureProcessorsInitialized,
} from '@auxx/lib/files/server'
import { createStorageManager } from '@auxx/lib/files/server'
import { UploadErrorHandler } from '@auxx/lib/files/server'
import type { UploadInitConfig } from '@auxx/lib/files/types'
import type { EntityType } from '@auxx/lib/files/types'
import { ENTITY_TYPES } from '@auxx/lib/files/types'

const logger = createScopedLogger('api-presigned-upload-sessions')

/**
 * Request schema for creating presigned upload sessions
 */
const CreateSessionSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string(),
  expectedSize: z.number().positive(),
  provider: z.enum(['S3', 'GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE', 'BOX', 'Local']).optional(),
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
    const uploadSession = await SessionManager.createSessionFromConfig(config)
    const storageManager = createStorageManager(session.user.defaultOrganizationId)

    if (config.uploadPlan.strategy === 'single') {
      // Single-part presigned upload with policy enforcement
      const presigned = await storageManager.generatePresignedUploadUrl({
        ...config,
        metadata: { sessionId: uploadSession.id },
      })

      const uploadMethod = presigned.method || 'PUT'

      await SessionManager.updateSession(uploadSession.id, {
        presignedUrl: presigned.url,
        presignedFields: presigned.fields,
        uploadMethod,
      })

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

      await SessionManager.updateSession(uploadSession.id, {
        uploadId: multipart.uploadId,
        partPresignEndpoint: `/api/files/upload/${uploadSession.id}/parts`,
        uploadMethod: 'PUT',
      })

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
    // Generate a temporary session ID for error tracking
    const tempSessionId = `temp-${Date.now()}`
    return await UploadErrorHandler.handleUploadError(error, tempSessionId, 'session-creation', {
      hasUser: !!session?.user,
    })
  }
}
