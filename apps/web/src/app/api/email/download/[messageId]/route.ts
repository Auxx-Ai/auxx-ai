// ~/app/api/email/download/[messageId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '~/auth/server'
import { database, schema } from '@auxx/database'
import { eq, or } from 'drizzle-orm'

export async function GET(request: NextRequest, { params }: { params: { messageId: string } }) {
  try {
    // Check authentication
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { messageId } = params

    // Get the message from database
    const message = await database.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, messageId),
      with: {
        thread: true,
        participants: {
          with: {
            participant: true,
          },
        },
        attachments: true,
      },
    })

    // Check authorization - message must belong to a thread in user's org or assigned to user
    if (
      !message?.thread ||
      (message.thread.organizationId !== session.user.defaultOrganizationId &&
        message.thread.assigneeId !== session.user.id)
    ) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Build email content in RFC 822 format
    const from = message.participants.find((p) => p.role === 'FROM')?.participant
    const to = message.participants.filter((p) => p.role === 'TO').map((p) => p.participant)
    const cc = message.participants.filter((p) => p.role === 'CC').map((p) => p.participant)

    let emailContent = ''
    emailContent += `Message-ID: <${message.id}>\n`
    emailContent += `Date: ${new Date(message.sentAt!).toUTCString()}\n`
    emailContent += `From: ${from?.name || ''} <${from?.identifier || ''}>\n`

    if (to.length > 0) {
      emailContent += `To: ${to.map((p) => `${p.name || ''} <${p.identifier}>`).join(', ')}\n`
    }

    if (cc.length > 0) {
      emailContent += `Cc: ${cc.map((p) => `${p.name || ''} <${p.identifier}>`).join(', ')}\n`
    }

    emailContent += `Subject: ${message.subject || 'No Subject'}\n`

    // Handle attachments in MIME format
    if (message.attachments && message.attachments.length > 0) {
      const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36)}`
      emailContent += `MIME-Version: 1.0\n`
      emailContent += `Content-Type: multipart/mixed; boundary="${boundary}"\n`
      emailContent += '\n'

      // Email body part
      emailContent += `--${boundary}\n`
      emailContent += `Content-Type: text/html; charset=UTF-8\n`
      emailContent += `Content-Transfer-Encoding: 8bit\n`
      emailContent += '\n'
      emailContent += message.textHtml || message.textPlain || ''
      emailContent += '\n'

      // Attachment parts
      for (const attachment of message.attachments) {
        emailContent += `--${boundary}\n`
        emailContent += `Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${attachment.name}"\n`
        emailContent += `Content-Transfer-Encoding: base64\n`
        emailContent += `Content-Disposition: attachment; filename="${attachment.name}"\n`
        emailContent += '\n'
        // Note: You'll need to fetch the actual attachment data from storage
        // For now, we'll add a placeholder comment
        emailContent += `[Attachment data would go here - ${attachment.name}]\n`
      }

      emailContent += `--${boundary}--\n`
    } else {
      // Simple single-part email
      emailContent += `Content-Type: text/html; charset=UTF-8\n`
      emailContent += '\n'
      emailContent += message.textHtml || message.textPlain || ''
    }

    // Return as .eml file
    return new NextResponse(emailContent, {
      headers: {
        'Content-Type': 'message/rfc822',
        'Content-Disposition': `attachment; filename="email-${messageId}.eml"`,
      },
    })
  } catch (error) {
    console.error('Error downloading email:', error)
    return NextResponse.json({ error: 'Failed to download email' }, { status: 500 })
  }
}
