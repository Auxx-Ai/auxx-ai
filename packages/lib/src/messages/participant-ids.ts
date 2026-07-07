// packages/lib/src/messages/participant-ids.ts

import { type Database, schema } from '@auxx/database'
import { type ParticipantId, toParticipantId } from '@auxx/types'
import { inArray } from 'drizzle-orm'

/**
 * Batch-resolve role-prefixed ParticipantId[] (from → replyto → to → cc → bcc,
 * matching the message-envelope order) for a set of message ids. Self-contained
 * (queries Message + MessageParticipant itself) so callers that only hold ids —
 * e.g. thread metadata resolving the latest message's envelope — don't need the
 * full MessageQueryService. Missing/deleted messages are simply absent from the
 * returned map.
 */
export async function getParticipantIdsByMessage(
  db: Database,
  messageIds: string[]
): Promise<Map<string, ParticipantId[]>> {
  const result = new Map<string, ParticipantId[]>()
  if (messageIds.length === 0) return result

  const [messages, messageParticipants] = await Promise.all([
    db.query.Message.findMany({
      where: inArray(schema.Message.id, messageIds),
      columns: { id: true, fromId: true, replyToId: true },
    }),
    db.query.MessageParticipant.findMany({
      where: inArray(schema.MessageParticipant.messageId, messageIds),
      columns: { messageId: true, participantId: true, role: true },
    }),
  ])

  const rolesByMessage = new Map<
    string,
    { from: string | null; replyTo: string | null; to: string[]; cc: string[]; bcc: string[] }
  >()
  for (const mp of messageParticipants) {
    let entry = rolesByMessage.get(mp.messageId)
    if (!entry) {
      entry = { from: null, replyTo: null, to: [], cc: [], bcc: [] }
      rolesByMessage.set(mp.messageId, entry)
    }
    switch (mp.role) {
      case 'FROM':
        entry.from = mp.participantId
        break
      case 'REPLY_TO':
        entry.replyTo = mp.participantId
        break
      case 'TO':
        entry.to.push(mp.participantId)
        break
      case 'CC':
        entry.cc.push(mp.participantId)
        break
      case 'BCC':
        entry.bcc.push(mp.participantId)
        break
    }
  }

  for (const message of messages) {
    const roles = rolesByMessage.get(message.id)
    const participants: ParticipantId[] = []
    const fromId = message.fromId ?? roles?.from
    if (fromId) participants.push(toParticipantId('from', fromId))
    const replyToId = message.replyToId ?? roles?.replyTo
    if (replyToId) participants.push(toParticipantId('replyto', replyToId))
    for (const id of roles?.to ?? []) participants.push(toParticipantId('to', id))
    for (const id of roles?.cc ?? []) participants.push(toParticipantId('cc', id))
    for (const id of roles?.bcc ?? []) participants.push(toParticipantId('bcc', id))
    result.set(message.id, participants)
  }

  return result
}
