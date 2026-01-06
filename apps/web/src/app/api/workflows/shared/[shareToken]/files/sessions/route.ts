// apps/web/src/app/api/workflows/shared/[shareToken]/files/sessions/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createStorageManager } from '@auxx/lib/files/server'
import { verifyWorkflowPassport, getSharedWorkflowByToken } from '@auxx/services/workflow-share'
import { setRedisData } from '@auxx/redis'
import { generateId } from '@auxx/utils/generateId'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('public-file-upload-session')

/** Session TTL in seconds (1 hour) */
const SESSION_TTL = 60 * 60

/** Default upload policy for public workflow file uploads */
const DEFAULT_UPLOAD_POLICY = {
  keyPrefix: 'public-workflow/',
  contentLengthRange: [1, 100 * 1024 * 1024] as [number, number], // 1 byte to 100MB
  maxTtl: 3600,
  allowedMimeTypes: ['*/*'],
}

/**
 * Get bucket name for private files from environment
 */
function getPrivateBucket(): string {
  return (
    process.env.S3_PRIVATE_BUCKET ||
    process.env.NEXT_PUBLIC_S3_PRIVATE_BUCKET ||
    process.env.S3_BUCKET ||
    ''
  )
}

/**
 * Extract file input config from workflow graph
 */
function getFileInputConfig(graph: unknown, nodeId: string) {
  const graphData = graph as {
    nodes?: Array<{
      id: string
      data?: {
        type?: string
        inputType?: string
        typeOptions?: {
          file?: {
            maxFileSize?: number
            allowedTypes?: string[]
            allowMultiple?: boolean
          }
        }
      }
    }>
  }
  const node = graphData?.nodes?.find((n) => n.id === nodeId)

  if (!node || node.data?.type !== 'form-input' || node.data?.inputType !== 'file') {
    return null
  }

  return {
    maxFileSize: node.data.typeOptions?.file?.maxFileSize,
    allowedTypes: node.data.typeOptions?.file?.allowedTypes,
    allowMultiple: node.data.typeOptions?.file?.allowMultiple,
  }
}

/**
 * POST /api/workflows/shared/[shareToken]/files/sessions
 * Creates a presigned upload session for public workflow file uploads
 *
 * Requires a valid passport token in Authorization header
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shareToken: string }> }
) {
  const { shareToken } = await context.params

  // 1. Verify passport token
  const authHeader = request.headers.get('authorization')
  const passportToken = authHeader?.replace('Bearer ', '')

  if (!passportToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const passportResult = await verifyWorkflowPassport(passportToken)
  if (passportResult.isErr()) {
    logger.warn('Invalid passport token for file upload', { error: passportResult.error })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const passport = passportResult.value

  // Verify passport matches the requested share token
  if (passport.shareToken !== shareToken) {
    return NextResponse.json({ error: 'Invalid passport for this workflow' }, { status: 401 })
  }

  // 2. Parse request
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { filename, mimeType, size, nodeId } = body

  if (!filename || !mimeType || !size || !nodeId) {
    return NextResponse.json(
      { error: 'Missing required fields: filename, mimeType, size, nodeId' },
      { status: 400 }
    )
  }

  // 3. Get workflow and validate
  const workflowResult = await getSharedWorkflowByToken({
    shareToken,
    requireEnabled: true,
    includeGraph: true,
  })

  if (workflowResult.isErr()) {
    logger.warn('Workflow not found for file upload', { shareToken, error: workflowResult.error })
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const workflow = workflowResult.value

  // 4. Get file input config from graph and validate
  const fileConfig = getFileInputConfig(workflow.graph, nodeId)
  if (!fileConfig) {
    return NextResponse.json({ error: 'Invalid file input node' }, { status: 400 })
  }

  // Convert maxFileSize from MB to bytes (stored in MB in workflow config)
  const maxFileSizeBytes = fileConfig.maxFileSize ? fileConfig.maxFileSize * 1024 * 1024 : undefined

  // Validate file size
  if (maxFileSizeBytes && size > maxFileSizeBytes) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${fileConfig.maxFileSize}MB` },
      { status: 400 }
    )
  }

  // Validate file type
  if (fileConfig.allowedTypes?.length && !fileConfig.allowedTypes.includes(mimeType)) {
    return NextResponse.json(
      {
        error: `File type ${mimeType} not allowed. Allowed types: ${fileConfig.allowedTypes.join(', ')}`,
      },
      { status: 400 }
    )
  }

  // 5. Generate storage key and presigned URL
  const sessionId = generateId('puf') // public-upload-file
  const bucket = getPrivateBucket()
  const storageKey = `public-workflow/${workflow.organizationId}/${shareToken}/${sessionId}/${filename}`

  try {
    const storageManager = createStorageManager(workflow.organizationId)

    // Build config for presigned URL generation
    // Note: We use 'FILE' as entityType since we're bypassing the processor system
    // The actual context is stored in Redis session metadata
    const config = {
      organizationId: workflow.organizationId,
      userId: passport.endUserId,
      fileName: filename,
      mimeType,
      expectedSize: size,
      entityType: 'FILE' as const,
      entityId: nodeId,
      provider: 'S3' as const,
      storageKey,
      ttlSec: SESSION_TTL,
      policy: {
        ...DEFAULT_UPLOAD_POLICY,
        allowedMimeTypes: fileConfig.allowedTypes?.length ? fileConfig.allowedTypes : ['*/*'],
        contentLengthRange: [
          1,
          maxFileSizeBytes || DEFAULT_UPLOAD_POLICY.contentLengthRange[1],
        ] as [number, number],
      },
      uploadPlan: { strategy: 'single' as const },
      visibility: 'PRIVATE' as const,
      bucket,
    }

    const presigned = await storageManager.generatePresignedUploadUrl(config)

    // Determine upload method: POST with fields or PUT
    const uploadMethod = presigned.fields ? 'POST' : 'PUT'

    // 6. Store session in Redis
    const sessionData = {
      storageKey,
      filename,
      mimeType,
      size,
      organizationId: workflow.organizationId,
      endUserId: passport.endUserId,
      shareToken,
      nodeId,
      bucket,
    }

    await setRedisData(`public-upload:${sessionId}`, sessionData, SESSION_TTL, true)

    logger.info('Created public file upload session', {
      sessionId,
      organizationId: workflow.organizationId,
      endUserId: passport.endUserId,
      filename,
      size,
    })

    return NextResponse.json({
      sessionId,
      presignedUrl: presigned.url,
      fields: presigned.fields,
      method: uploadMethod,
    })
  } catch (error) {
    logger.error('Failed to create upload session', {
      error: error instanceof Error ? error.message : String(error),
      shareToken,
      nodeId,
    })
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 })
  }
}
