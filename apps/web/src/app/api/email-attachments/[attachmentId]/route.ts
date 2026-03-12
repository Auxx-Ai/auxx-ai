// apps/web/src/app/api/email-attachments/[attachmentId]/route.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

/** Runs the route in the Node.js runtime so binary responses work consistently. */
export const runtime = 'nodejs'

/** Scoped logger for inline email attachment requests. */
const logger = createScopedLogger('api-email-attachments-inline')

/**
 * Route params for inline email attachment requests.
 */
interface RouteParams {
  params: Promise<{ attachmentId: string }>
}

/**
 * Record shape used for serving stored inbound email attachments.
 */
interface InlineEmailAttachmentRecord {
  id: string
  name: string
  mimeType: string
  content: string | null
  contentLocation: string | null
}

/**
 * Decodes a stored base64 email attachment payload into a binary buffer.
 */
function decodeInlineAttachmentContent(content: string): Buffer {
  const normalizedContent = content.includes(',') ? content.split(',').at(-1) || '' : content
  return Buffer.from(normalizedContent, 'base64')
}

/**
 * Sanitizes a filename for use in the Content-Disposition header.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/"/g, '')
}

/**
 * Loads an inline email attachment scoped to the signed-in user's organization.
 */
async function getInlineEmailAttachment(
  organizationId: string,
  attachmentId: string
): Promise<InlineEmailAttachmentRecord | null> {
  const [attachment] = await db
    .select({
      id: schema.EmailAttachment.id,
      name: schema.EmailAttachment.name,
      mimeType: schema.EmailAttachment.mimeType,
      content: schema.EmailAttachment.content,
      contentLocation: schema.EmailAttachment.contentLocation,
    })
    .from(schema.EmailAttachment)
    .innerJoin(schema.Message, eq(schema.EmailAttachment.messageId, schema.Message.id))
    .where(
      and(
        eq(schema.EmailAttachment.id, attachmentId),
        eq(schema.Message.organizationId, organizationId)
      )
    )
    .limit(1)

  return attachment ?? null
}

/**
 * Serves a stored inbound email attachment for inline rendering in the mail UI.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { attachmentId } = await params
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization required', { status: 400 })
    }

    const attachment = await getInlineEmailAttachment(organizationId, attachmentId)
    if (!attachment) {
      return new Response('Not found', { status: 404 })
    }

    if (!attachment.content && attachment.contentLocation) {
      return NextResponse.redirect(attachment.contentLocation, 302)
    }

    if (!attachment.content) {
      return new Response('Attachment content unavailable', { status: 404 })
    }

    const buffer = decodeInlineAttachmentContent(attachment.content)
    const body = new Uint8Array(buffer)

    return new Response(body, {
      headers: {
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `inline; filename="${sanitizeFilename(attachment.name)}"`,
        'Content-Length': buffer.length.toString(),
        'Content-Type': attachment.mimeType || 'application/octet-stream',
      },
    })
  } catch (error) {
    logger.error('Inline email attachment error', { error })
    return new Response('Internal error', { status: 500 })
  }
}
