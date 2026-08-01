// apps/web/src/app/api/email/download/[messageId]/route.ts

import { database, schema } from '@auxx/database'
import { getCachedUserInstanceGrants } from '@auxx/lib/cache'
import { getThreadLens } from '@auxx/lib/permissions/visibility'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

export const runtime = 'nodejs'

const logger = createScopedLogger('api-email-download')

interface RouteParams {
  params: Promise<{ messageId: string }>
}

/** RFC 2045 requires base64 body lines to be wrapped; 76 chars is the canonical width. */
function foldBase64(value: string): string {
  return value.replace(/.{1,76}/g, '$&\n')
}

/**
 * GET /api/email/download/[messageId]
 *
 * Serves a message as an RFC 822 `.eml` download. Driven by the message actions
 * menu in the thread view (`components/mail/thread-provider.tsx`).
 *
 * The payload is the full message body, which is `full`-tier under
 * mail-permissions §7 — so this gates on exactly the same thread lens as
 * `/api/messages/[messageId]/body`, and returns the same 404 (not 403) to a
 * sub-full viewer so message ids stay unprobeable.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { messageId } = await params

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 403 })
    }

    const message = await database.query.Message.findFirst({
      where: (messages, { and: andW, eq: eqW }) =>
        andW(eqW(messages.id, messageId), eqW(messages.organizationId, organizationId)),
      with: {
        thread: true,
        participants: { with: { participant: true } },
        // NOTE: no `attachments` relation exists on `Message`. Attachments moved
        // to the polymorphic canonical `Attachment` table keyed by
        // `(entityType, entityId)`, so there is nothing for Drizzle to resolve —
        // naming it here threw `Cannot read properties of undefined (reading
        // 'referencedTable')` and made this route a guaranteed 500. They are
        // loaded separately below.
      },
    })

    if (!message?.threadId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const viewer = await getCachedUserInstanceGrants(session.user.id, organizationId)
    const lens = await getThreadLens(database, organizationId, viewer, message.threadId)
    if (lens !== 'read') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Canonical attachments: `title` carries the filename, the MIME type lives on
    // the linked `MediaAsset`. Same projection `MessageQueryService` uses.
    const attachments = await database
      .select({
        title: schema.Attachment.title,
        mimeType: schema.MediaAsset.mimeType,
      })
      .from(schema.Attachment)
      .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
      .where(
        and(
          eq(schema.Attachment.organizationId, organizationId),
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId)
        )
      )
      .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))

    const from = message.participants.find((p) => p.role === 'FROM')?.participant
    const to = message.participants.filter((p) => p.role === 'TO').map((p) => p.participant)
    const cc = message.participants.filter((p) => p.role === 'CC').map((p) => p.participant)

    const body = message.textHtml || message.textPlain || ''
    const lines: string[] = [
      `Message-ID: ${message.internetMessageId || `<${message.id}>`}`,
      `Date: ${new Date(message.sentAt ?? message.createdAt).toUTCString()}`,
      `From: ${from?.name || ''} <${from?.identifier || ''}>`,
    ]

    if (to.length > 0) {
      lines.push(`To: ${to.map((p) => `${p.name || ''} <${p.identifier}>`).join(', ')}`)
    }
    if (cc.length > 0) {
      lines.push(`Cc: ${cc.map((p) => `${p.name || ''} <${p.identifier}>`).join(', ')}`)
    }
    lines.push(`Subject: ${message.subject || 'No Subject'}`)

    let emailContent: string
    if (attachments.length > 0) {
      const boundary = `----=_Part_${message.id}`
      lines.push('MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '')
      emailContent = lines.join('\n')

      emailContent += `\n--${boundary}\n`
      emailContent += 'Content-Type: text/html; charset=UTF-8\n'
      emailContent += 'Content-Transfer-Encoding: 8bit\n\n'
      emailContent += `${body}\n`

      // Metadata-only parts. The bytes live in object storage behind their own
      // per-attachment gate (`/api/attachments/[attachmentId]/content`), and
      // inlining them here would mean streaming every blob through this route —
      // so the `.eml` names the attachments without carrying them. This is the
      // long-standing behaviour of this endpoint, now at least well-formed MIME.
      for (const attachment of attachments) {
        const name = attachment.title ?? 'attachment'
        emailContent += `\n--${boundary}\n`
        emailContent += `Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${name}"\n`
        emailContent += 'Content-Transfer-Encoding: base64\n'
        emailContent += `Content-Disposition: attachment; filename="${name}"\n\n`
        emailContent += foldBase64(
          Buffer.from(`Attachment "${name}" is not included in this export.`).toString('base64')
        )
      }

      emailContent += `\n--${boundary}--\n`
    } else {
      lines.push('MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '')
      emailContent = `${lines.join('\n')}\n${body}`
    }

    return new NextResponse(emailContent, {
      headers: {
        'Content-Type': 'message/rfc822',
        'Content-Disposition': `attachment; filename="email-${messageId}.eml"`,
      },
    })
  } catch (error) {
    logger.error('Error downloading email:', { error })
    return NextResponse.json({ error: 'Failed to download email' }, { status: 500 })
  }
}
