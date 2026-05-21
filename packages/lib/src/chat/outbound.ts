// packages/lib/src/chat/outbound.ts

import { schema } from '@auxx/database'
import type { MessageEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { MessageSenderService } from '../messages'
import { ParticipantService } from '../participants/participant-service'
import { ProviderRegistryService } from '../providers/provider-registry-service'
import { Result, type TypedResult } from '../result'
import type { ServiceContext } from './types'

export interface SendAgentChatMessageInput {
  threadId: string
  agentUserId: string
  content: string
  attachmentIds?: string[]
}

/**
 * Send an agent's reply into a chat thread.
 *
 * Thin wrapper around `MessageSenderService.sendMessage` with chat-shaped
 * input — subject = null, empty `to`, no recipient identifiers. The capability
 * matrix on the chat provider tells the sender service to skip the usage guard,
 * subject/recipient validation, and post-send sync.
 */
export async function sendAgentChatMessage(
  ctx: ServiceContext,
  input: SendAgentChatMessageInput
): Promise<TypedResult<MessageEntity, Error>> {
  try {
    const [thread] = await ctx.db
      .select({
        id: schema.Thread.id,
        integrationId: schema.Thread.integrationId,
        organizationId: schema.Thread.organizationId,
      })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.id, input.threadId),
          eq(schema.Thread.organizationId, ctx.organizationId)
        )
      )
      .limit(1)
    if (!thread) return Result.error(new Error(`Thread ${input.threadId} not found`))

    // Resolve (or lazy-create) the agent's EMAIL Participant — same row email
    // outbound uses, so no separate identifier type per channel.
    const participantService = new ParticipantService(ctx.organizationId, ctx.db)
    const agentParticipant = await participantService.findOrCreateParticipantForUser(
      input.agentUserId
    )

    const providerRegistry = new ProviderRegistryService(ctx.organizationId)
    const sender = new MessageSenderService(ctx.organizationId, providerRegistry, ctx.db)

    const sent = await sender.sendMessage({
      userId: input.agentUserId,
      organizationId: ctx.organizationId,
      integrationId: thread.integrationId,
      threadId: thread.id,
      subject: null as any,
      textPlain: input.content,
      to: [
        // Echo the agent as the sole participant entry — keeps the sender
        // service's processParticipants happy without forcing a recipient.
        {
          identifier: agentParticipant.identifier,
          identifierType: 'EMAIL' as any,
        },
      ] as any,
      attachmentIds: input.attachmentIds,
    } as any)

    if (!sent?.id) {
      return Result.error(new Error('MessageSenderService returned no message id'))
    }

    const [row] = await ctx.db
      .select()
      .from(schema.Message)
      .where(eq(schema.Message.id, sent.id))
      .limit(1)
    if (!row) {
      return Result.error(new Error(`Sent message ${sent.id} not found after send`))
    }
    return Result.ok(row)
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
