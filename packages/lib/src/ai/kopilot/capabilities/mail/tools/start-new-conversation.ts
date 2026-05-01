// packages/lib/src/ai/kopilot/capabilities/mail/tools/start-new-conversation.ts

import { z } from 'zod'
import { getCachedIntegrationCatalog } from '../../../../../cache/integration-catalog'
import { DraftService } from '../../../../../drafts'
import { MessageSenderService } from '../../../../../messages'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { EmailWriteDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { resolveRecipients } from '../recipient-resolver'
import { stripSignOff } from './strip-sign-off'

interface StartArgs {
  integrationId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  body: string
  subject?: string
  /** Resolved at approval time via the approval card's `inputAmendment.mode`. */
  mode?: 'draft' | 'send'
  attachments?: string[]
}

const StartAmendmentSchema = z.object({
  mode: z.enum(['draft', 'send']),
  body: z.string().optional(),
  subject: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
})

export function createStartNewConversationTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'start_new_conversation',
    requiresApproval: true,
    inputAmendmentSchema: StartAmendmentSchema,
    outputDigestSchema: EmailWriteDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        threadId?: string
        draftId?: string
        messageId?: string
        mode?: 'draft' | 'send'
        status?: string
        subject?: string | null
        body?: string
        resolvedRecipients?: Array<{ displayName?: string; identifier?: string }>
      }
      return {
        threadId: out.threadId,
        draftId: out.draftId,
        messageId: out.messageId,
        mode: out.mode === 'send' ? 'send' : 'draft',
        status: out.status,
        subject: out.subject ?? undefined,
        recipients: Array.isArray(out.resolvedRecipients)
          ? out.resolvedRecipients.map((r) => r.displayName ?? r.identifier ?? '').filter(Boolean)
          : undefined,
        body: out.body,
      }
    },
    usageNotes:
      'Always pauses for approval; the user picks Save as Draft or Send in the approval card. For email channels `subject` is required; on messaging channels it is silently ignored.',
    description:
      'Start a brand-new outbound conversation on an integration that supports it (no existing thread). Recipients are recordIds, participantIds, or raw identifiers — the tool picks the channel-appropriate identifier from the record. The user picks save-as-draft vs send in the approval card; do NOT pass a `mode` argument.',
    parameters: {
      type: 'object',
      properties: {
        integrationId: {
          type: 'string',
          description:
            'The integration to send through. Must support `newOutbound` per the integration catalog.',
        },
        to: {
          type: 'array',
          items: { type: 'string' },
          description:
            'recordIds, participantIds, or raw identifiers. The tool picks the channel-appropriate identifier from the record.',
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Same shape as `to`. Email channels only.',
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Same shape as `to`. Email channels only.',
        },
        body: {
          type: 'string',
          description: 'Body. No sign-offs / signatures for email.',
        },
        subject: {
          type: 'string',
          description: 'Required for email channels. Silently dropped on messaging channels.',
        },
        attachments: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['integrationId', 'to', 'body'],
      additionalProperties: false,
    },
    summary: (args) => {
      const a = args as Partial<StartArgs>
      const to = Array.isArray(a.to) ? a.to.join(', ').slice(0, 40) : 'recipients'
      const body = a.body ?? ''
      return `Compose to ${to}: "${body.slice(0, 50)}${body.length > 50 ? '…' : ''}"`
    },
    execute: async (rawArgs, agentDeps) => {
      const args = rawArgs as Partial<StartArgs>
      const { db } = getDeps()
      if (!args.integrationId) {
        return { success: false, output: null, error: 'integrationId is required' }
      }
      if (!args.to || args.to.length === 0) {
        return { success: false, output: null, error: 'to is required and must be non-empty' }
      }
      const body = stripSignOff(args.body ?? '')
      // Mode is set by the approval card's input amendment; default to draft.
      const mode: 'draft' | 'send' = args.mode === 'send' ? 'send' : 'draft'

      const catalog = await getCachedIntegrationCatalog(agentDeps.organizationId)
      const integration = catalog.find((i) => i.integrationId === args.integrationId)
      if (!integration) {
        return {
          success: false,
          output: null,
          error: `Integration ${args.integrationId} is not in the available catalog`,
        }
      }
      if (!integration.newOutbound) {
        const alternatives = catalog
          .filter((i) => i.newOutbound)
          .map((i) => `${i.displayName} (\`${i.integrationId}\`)`)
        return {
          success: false,
          output: null,
          error: `Integration ${integration.platform} does not support starting new conversations. Try: ${alternatives.join(', ') || '(no alternatives connected)'}`,
        }
      }
      if (integration.channel !== 'email' && (args.cc?.length || args.bcc?.length)) {
        return {
          success: false,
          output: null,
          error: `cc/bcc are not supported on ${integration.platform} (messaging channel)`,
        }
      }
      if (integration.channel === 'email' && !args.subject) {
        return {
          success: false,
          output: null,
          error: 'subject is required for email channels',
        }
      }

      const resolvedResult = await resolveRecipients(
        { to: args.to, cc: args.cc, bcc: args.bcc },
        integration,
        { ...agentDeps, db }
      )
      if (!resolvedResult.ok) {
        return { success: false, output: null, error: resolvedResult.error.message }
      }
      const resolved = resolvedResult.value

      const toIds = resolved.filter((r) => r.role === 'to')
      const ccIds = resolved.filter((r) => r.role === 'cc')
      const bccIds = resolved.filter((r) => r.role === 'bcc')

      // `subject` is silently dropped on messaging channels per channel-arg policy.
      const subject = integration.channel === 'email' ? args.subject : undefined

      if (mode === 'draft') {
        const draftService = new DraftService(db, agentDeps.organizationId, agentDeps.userId)
        const draft = await draftService.create({
          integrationId: integration.integrationId,
          threadId: null,
          content: {
            bodyHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
            bodyText: body,
            subject,
            recipients: {
              to: toIds.map((r) => ({
                identifier: r.identifier,
                identifierType: r.identifierType,
              })),
              cc: ccIds.map((r) => ({
                identifier: r.identifier,
                identifierType: r.identifierType,
              })),
              bcc: bccIds.map((r) => ({
                identifier: r.identifier,
                identifierType: r.identifierType,
              })),
            },
            attachments: [],
          },
        })
        return {
          success: true,
          output: {
            draftId: draft.id,
            mode: 'draft',
            subject,
            body,
            resolvedRecipients: resolved,
            status: 'draft_saved',
          },
        }
      }

      const senderService = new MessageSenderService(agentDeps.organizationId, undefined, db)
      const result = await senderService.sendMessage({
        userId: agentDeps.userId,
        organizationId: agentDeps.organizationId,
        integrationId: integration.integrationId,
        subject: subject ?? '',
        textHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
        textPlain: body,
        to: toIds.map((r) => ({
          identifier: r.identifier,
          identifierType: r.identifierType,
          name: r.displayName,
        })),
        cc: ccIds.length
          ? ccIds.map((r) => ({
              identifier: r.identifier,
              identifierType: r.identifierType,
              name: r.displayName,
            }))
          : undefined,
        bcc: bccIds.length
          ? bccIds.map((r) => ({
              identifier: r.identifier,
              identifierType: r.identifierType,
              name: r.displayName,
            }))
          : undefined,
      })

      return {
        success: true,
        output: {
          messageId: result.id,
          threadId: result.threadId,
          mode: 'send',
          subject,
          body,
          resolvedRecipients: resolved,
          status: result.sendStatus,
        },
      }
    },
  }
}
