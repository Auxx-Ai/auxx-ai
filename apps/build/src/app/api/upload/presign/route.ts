// apps/build/src/app/api/upload/presign/route.ts

import { configService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { S3Adapter } from '@auxx/lib/files/adapters'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getLocalSession } from '~/lib/auth'

const logger = createScopedLogger('build-upload-presign')

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX_ICON_SIZE = 2 * 1024 * 1024 // 2MB
const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * POST /api/upload/presign
 * Generates a presigned S3 URL for uploading app assets (icon, screenshots)
 */
export async function POST(request: NextRequest) {
  const session = await getLocalSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    appId: string
    fileName: string
    mimeType: string
    size: number
    type?: 'icon' | 'screenshot'
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { appId, fileName, mimeType, size } = body

  if (!appId || !fileName || !mimeType || !size) {
    return NextResponse.json(
      { error: 'Missing required fields: appId, fileName, mimeType, size' },
      { status: 400 }
    )
  }

  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { error: `Invalid file type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  const uploadType = body.type || 'icon'
  const maxSize = uploadType === 'screenshot' ? MAX_SCREENSHOT_SIZE : MAX_ICON_SIZE

  if (size > maxSize) {
    return NextResponse.json(
      { error: `File too large. Maximum size: ${maxSize / 1024 / 1024}MB` },
      { status: 400 }
    )
  }

  // Verify app exists and user has access
  const app = await database.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.id, appId),
  })

  if (!app) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 })
  }

  const member = await database.query.DeveloperAccountMember.findFirst({
    where: (members, { and, eq }) =>
      and(
        eq(members.developerAccountId, app.developerAccountId),
        eq(members.userId, session.userId)
      ),
  })

  if (!member) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Generate storage key
  const ext = fileName.split('.').pop() || 'png'
  const timestamp = Date.now()
  const folder = uploadType === 'screenshot' ? 'screenshots' : 'icon'
  const storageKey = `apps/${appId}/${folder}/${timestamp}.${ext}`

  try {
    const adapter = new S3Adapter()
    const presigned = await adapter.presignUpload({
      key: storageKey,
      mimeType,
      size,
      visibility: 'PUBLIC',
      ttlSec: 600, // 10 minutes
    })

    const cdnBase = configService.get<string>('CDN_URL')
    let cdnUrl: string
    if (cdnBase) {
      cdnUrl = `${cdnBase}/${storageKey}`
    } else {
      const bucket = configService.get<string>('S3_PUBLIC_BUCKET') || ''
      const region = configService.get<string>('S3_REGION') || 'us-west-1'
      cdnUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`
    }

    return NextResponse.json({
      presignedUrl: presigned.url,
      fields: presigned.fields,
      method: presigned.fields ? 'POST' : 'PUT',
      headers: presigned.headers,
      storageKey,
      cdnUrl,
    })
  } catch (error) {
    logger.error('Failed to generate presigned URL', { error, appId })
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
  }
}
