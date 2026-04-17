// apps/web/src/components/mail/utils/to-editor-message.ts

import type { MessageMeta, ParticipantMeta } from '~/components/threads/store'
import type { MessageType } from '../email-editor/types'

interface ResolvedParticipants {
  from: ParticipantMeta | undefined
  to: ParticipantMeta[]
  cc: ParticipantMeta[]
}

/**
 * Transform a store MessageMeta + resolved participants into the editor's MessageType shape.
 * Converts ISO-string dates to Date objects and builds the role-tagged participants array.
 */
export function toEditorMessage(
  message: MessageMeta,
  { from, to, cc }: ResolvedParticipants
): MessageType {
  const toRef = (p: ParticipantMeta) => ({
    id: p.id,
    identifier: p.identifier,
    identifierType: p.identifierType,
    name: p.name,
  })

  return {
    id: message.id,
    threadId: message.threadId,
    subject: message.subject,
    snippet: message.snippet,
    textHtml: message.textHtml,
    textPlain: message.textPlain,
    isInbound: message.isInbound,
    sentAt: message.sentAt ? new Date(message.sentAt) : null,
    createdAt: new Date(message.createdAt),
    messageType: message.messageType as MessageType['messageType'],
    sendStatus: message.sendStatus,
    providerError: message.providerError,
    attempts: message.attempts,
    from: from
      ? {
          id: from.id,
          identifier: from.identifier,
          identifierType: from.identifierType,
          name: from.name,
          displayName: from.displayName,
        }
      : null,
    participants: [
      ...(from ? [{ role: 'FROM', participant: toRef(from) }] : []),
      ...to.map((p) => ({ role: 'TO', participant: toRef(p) })),
      ...cc.map((p) => ({ role: 'CC', participant: toRef(p) })),
    ],
  }
}
