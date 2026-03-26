// apps/web/src/components/workflow/nodes/shared/node-inputs/thread-input.tsx

import type { MessageMeta, ParticipantMeta, ThreadMeta } from '~/components/threads/store'

interface TransformInput {
  thread: ThreadMeta
  latestMessage: MessageMeta
  from: ParticipantMeta | undefined
  to: ParticipantMeta[]
  cc: ParticipantMeta[]
}

/**
 * Transform thread data to workflow trigger input format.
 * Output shape matches what MessageReceivedProcessor expects on the backend:
 * - from.identifier (not from.email)
 * - textPlain / textHtml (not content.text / content.html)
 */
export function transformThreadToWorkflowInput({
  thread,
  latestMessage,
  from,
  to,
  cc,
}: TransformInput): Record<string, any> {
  return {
    message: {
      id: latestMessage.id,
      threadId: thread.id,
      integrationId: thread.integrationId || '',
      subject: latestMessage.subject || thread.subject || '',
      textPlain: latestMessage.textPlain || '',
      textHtml: latestMessage.textHtml || '',
      snippet: latestMessage.snippet || '',
      isInbound: latestMessage.isInbound,
      hasAttachments: latestMessage.hasAttachments ?? false,
      receivedAt: latestMessage.sentAt || new Date().toISOString(),
      from: from
        ? {
            identifier: from.identifier || '',
            name: from.name || from.displayName || '',
          }
        : null,
      to: to.map((p) => ({
        identifier: p.identifier || '',
        name: p.name || p.displayName || '',
      })),
      cc: cc.map((p) => ({
        identifier: p.identifier || '',
        name: p.name || p.displayName || '',
      })),
    },
  }
}
