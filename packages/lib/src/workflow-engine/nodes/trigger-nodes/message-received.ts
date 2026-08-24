// packages/lib/src/workflow-engine/nodes/trigger-nodes/message-received.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { ParticipantRole } from '@auxx/database/enums'
import type { ThreadEntity } from '@auxx/database/types'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../../cache'
import { evaluateMessageConditions } from '../../../message-trigger-conditions'
import type { MessageReceivedNodeData } from '../../catalog/nodes/message-received'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, TEST_RECORD_ID, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Config (`node.data`) for the MESSAGE_RECEIVED trigger node — the config
 * subset of the catalog's `MessageReceivedNodeData` (node-catalog Phase 1;
 * this file previously shadowed it). Deliberately WITHOUT `channelIds`: the
 * `triggerMessageWorkflows` dispatcher reads channel scope off the published
 * graph; the runtime processor never re-checks it.
 *
 * `conditions` are evaluated via `message-trigger-conditions/evaluate.ts`'s
 * `evaluateMessageConditions`, which fails CLOSED (non-match) on any condition
 * that doesn't evaluate as written. The legacy `filters` (single-valued
 * domain/keyword matchers) and `message_filter` (dead builder toggle) keys are
 * ignored if still present on an old graph — the runtime path that evaluated
 * them was deleted outright (plan
 * `2026-08-12-message-trigger-scoping-and-send-safety.md` §3).
 *
 * `machineMail` is likewise a dispatcher gate: `'exclude'` (default when
 * absent) skips soft machine mail, hard-tier machine mail (bounces/NDRs) is
 * always skipped regardless. So is `ownAddress`: `'include'` (default when
 * absent) fires on mail from the org's own channel addresses, `'exclude'`
 * skips it; a proven echo of mail this org sent is always skipped regardless.
 */
export type MessageReceivedTriggerConfig = Pick<
  MessageReceivedNodeData,
  'conditions' | 'machineMail' | 'ownAddress'
>

/** Output shape for the `message.attachments` node variable. */
interface MessageAttachmentOutput {
  name: string
  size: number
  type: string | null
  url: string | null
}

/** Output shape for a single `message.from` / `message.to[*]` participant. */
interface MessageParticipantOutput {
  email: string
  name: string
}

/**
 * Output shape for the `message` node variable — the object the builder's
 * picker advertises (`nodes/core/message-received/schema.ts`), key for key.
 * Written as one container so both the container paths (`message`,
 * `message.from`) and every leaf resolve; see the write site for why.
 */
interface MessageOutput {
  id: string
  thread_id: string
  from: MessageParticipantOutput | null
  to: MessageParticipantOutput[]
  subject: string
  body: string
  html: string
  received_at: string
  has_attachments: boolean
  attachments: MessageAttachmentOutput[]
}

/**
 * Lazily resolve attachments for `message.attachments` — only queried when
 * `hasAttachments` is true. One row-listing query plus one
 * `getAttachmentDownloadInfo` call per attachment (bounded by the message's own
 * attachment count). That function returns a `Result` rather than throwing, and
 * an `err` degrades to a null URL here rather than failing the trigger node —
 * the same fail-soft contract the deleted `AttachmentService.getDownloadInfo`
 * had via its `.catch(() => null)`.
 */
async function loadMessageAttachments(
  messageId: string,
  organizationId: string,
  db: Database
): Promise<MessageAttachmentOutput[]> {
  const rows = await db
    .select({ id: schema.Attachment.id })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.entityType, 'MESSAGE'),
        eq(schema.Attachment.entityId, messageId),
        eq(schema.Attachment.organizationId, organizationId)
      )
    )
    .orderBy(schema.Attachment.sort)

  if (rows.length === 0) return []

  // Dynamic import — keeps this trigger node's static import graph free of
  // the storage dependency chain, matching `file-context-service.ts`'s
  // `refreshAttachmentUrl` precedent.
  const { getAttachmentDownloadInfo, createStorageManagerLocationPort, createS3StoragePort } =
    await import('../../../files/server')
  const ctx = { db, organizationId }
  const deps = {
    storage: createS3StoragePort(organizationId),
    now: () => new Date(),
    locations: createStorageManagerLocationPort(organizationId),
  }
  return Promise.all(
    rows.map(async (row) => {
      const result = await getAttachmentDownloadInfo(ctx, deps, row.id)
      const info = result.isOk() ? result.value : null
      return {
        name: info?.filename ?? 'attachment',
        size: info?.size !== undefined ? Number(info.size) : 0,
        type: info?.mimeType ?? null,
        url: info?.url ?? null,
      }
    })
  )
}

/**
 * Normalise `Message.receivedAt` (a `Date` column, or a string once the row has
 * been through JSON) into the ISO string the builder advertises `received_at`
 * as. A `Date` would interpolate as `Mon Aug 11 2026 10:00:00 GMT+0200 (…)`,
 * which no downstream date operator can parse; an unparseable value falls back
 * to now rather than throwing out of the trigger.
 */
function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/**
 * Output shape for the `ticket` node variable. Deliberately the entity-object
 * shape the downstream nodes already read an id out of — CRUD's `resourceId`
 * (`BaseNodeProcessor.extractIdFromValue`) and relation inputs
 * (`parseRelationInput`) both take `.id` — which a bare `RecordId` string is
 * not (it would reach `UnifiedCrudHandler` as `"<defId>:<instanceId>"`).
 */
interface LinkedTicketOutput {
  id: string
  entityDefinitionId: string
}

/**
 * Resolve the ticket linked to the message's thread.
 *
 * A thread carries one primary linked record (`Thread.primaryEntityInstanceId`,
 * which replaced the legacy ticket-only column) and that record can be any
 * entity definition — deal, lead, ticket — so the def is checked against the
 * org's `ticket` definition before it is published under a `ticket` name.
 *
 * Returns `null` when the thread has no primary record or its primary record is
 * not a ticket. Mail ingest never mints or links one (`ingest/store-message.ts`
 * writes no primary-entity columns), so this only resolves on a thread someone
 * has already linked a ticket to.
 */
async function resolveLinkedTicket(
  thread: ThreadEntity | undefined,
  organizationId: string
): Promise<LinkedTicketOutput | null> {
  const instanceId = thread?.primaryEntityInstanceId
  const definitionId = thread?.primaryEntityDefinitionId
  if (!instanceId || !definitionId) return null

  const ticketDefinitionId = await getCachedEntityDefId(organizationId, 'ticket')
  if (!ticketDefinitionId || ticketDefinitionId !== definitionId) return null

  return { id: instanceId, entityDefinitionId: definitionId }
}

/**
 * Trigger node that activates when a message is received
 * This node serves as an entry point for message-based workflows
 */
export class MessageReceivedProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.MESSAGE_RECEIVED

  /**
   * Extract required variables from node configuration
   * Trigger nodes don't use upstream variables as they start workflows
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Message received trigger nodes start workflows and don't depend on upstream variables
    // Filters are static and don't support variable interpolation
    return []
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const context = contextManager.getContext()

    // Check if we have a message to process
    if (!context.message) {
      throw new Error('No message found in execution context')
    }

    contextManager.log('INFO', node.name, 'Message trigger activated', {
      messageId: context.message.id,
      subject: context.message.subject,
      from: context.message.from?.identifier,
    })

    // Set message-related variables in context (legacy global variables)
    contextManager.setVariable('messageId', context.message.id)
    contextManager.setVariable('messageSubject', context.message.subject || '')
    contextManager.setVariable('messageFrom', context.message.from?.identifier || '')
    contextManager.setVariable(
      'messageBody',
      context.message.textPlain || context.message.textHtml || ''
    )
    contextManager.setVariable('messageSnippet', context.message.snippet || '')
    contextManager.setVariable('isInbound', context.message.isInbound)
    contextManager.setVariable('hasAttachments', context.message.hasAttachments)

    // `message.to` — derive from the hydrated MessageParticipant join rows
    // (populated by `loadProcessedMessage` for real triggers; empty for the
    // stale test-runner mock, which is fine — an empty recipients list).
    const toRecipients: MessageParticipantOutput[] = (context.message.participants || [])
      .filter((p) => p.role === ParticipantRole.TO && p.participant)
      .map((p) => ({
        email: p.participant?.identifier || '',
        name: p.participant?.name || '',
      }))

    // `message.attachments` — lazy, only queried when the message actually
    // has attachments (see `loadMessageAttachments` above for the URL-
    // resolution fallback behavior).
    const attachments = context.message.hasAttachments
      ? await loadMessageAttachments(
          context.message.id,
          context.organizationId,
          context.db ?? defaultDb
        )
      : []

    // The whole message object, written ONCE at `message`. The picker advertises
    // `message` and `message.from` as selectable OBJECT variables — a field with
    // no type filter (an AI prompt, for one) accepts any variable, so a user can
    // and does insert `{{trigger.message}}` — and the store is flat-keyed, so a
    // per-leaf write would leave both container paths resolving to nothing.
    // Writing the container instead covers every leaf too: `resolveVariablePath`
    // falls back to the longest stored prefix and walks INTO its value, which is
    // the same shape `webhook-processor.ts` relies on for `body`/`headers`/`query`.
    const messageOutput: MessageOutput = {
      id: context.message.id,
      thread_id: context.message.threadId || '',
      from: context.message.from
        ? {
            email: context.message.from.identifier || '',
            name: context.message.from.name || '',
          }
        : null,
      to: toRecipients,
      subject: context.message.subject || '',
      body: context.message.textPlain || context.message.textHtml || '',
      html: context.message.textHtml || '',
      received_at: toIsoTimestamp(context.message.receivedAt),
      has_attachments: context.message.hasAttachments,
      attachments,
    }
    contextManager.setNodeVariable(node.nodeId, 'message', messageOutput)

    // Set thread-related variables — use TEST_RECORD_ID as fallback for test/manual mode
    const threadId = context.message.threadId || TEST_RECORD_ID
    const messageId = context.message.id || TEST_RECORD_ID
    contextManager.setVariable('threadId', threadId)

    // Set RELATION output variables using RecordId format (entityDefinitionId:entityInstanceId)
    contextManager.setNodeVariable(node.nodeId, 'thread', toRecordId('thread', threadId))
    contextManager.setNodeVariable(node.nodeId, 'message_ref', toRecordId('message', messageId))

    // `ticket` — the thread's linked ticket, or `null` when it has none. The
    // miss is written deliberately (same reason the Find node writes its own):
    // a downstream `{{trigger.ticket}}` has to read as "no ticket" rather than
    // as a variable that does not exist.
    contextManager.setNodeVariable(
      node.nodeId,
      'ticket',
      await resolveLinkedTicket(context.message.thread, context.organizationId)
    )

    // Set organization context
    contextManager.setVariable('organizationId', context.organizationId)

    // Evaluate content conditions — the shared condition-group shape written by
    // the condition builder (see `MessageReceivedTriggerConfig.conditions`).
    // `undefined`/empty conditions match every message; a condition that could
    // not be evaluated as written counts as a non-match (fail closed) inside
    // `evaluateMessageConditions` itself.
    const data = node.data as MessageReceivedTriggerConfig
    if (data.conditions && data.conditions.length > 0) {
      const { matched, diagnostics } = evaluateMessageConditions(context.message, data.conditions)
      if (!matched) {
        contextManager.log(
          'INFO',
          node.name,
          'Message filtered out by trigger conditions',
          diagnostics.length > 0 ? { diagnostics } : undefined
        )
        return {
          status: NodeRunningStatus.Skipped,
          output: { filtered: true, reason: 'Did not pass trigger conditions' },
        }
      }
    }

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        messageId: context.message.id,
        subject: context.message.subject,
        triggeredAt: new Date(),
        threadId: context.message.threadId,
      },
      outputHandle: 'source', // Standard output for trigger nodes
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const data = node.data as MessageReceivedTriggerConfig

    // Validate conditions if present. Same shape record rules and resource
    // triggers validate — an array of condition groups, each carrying an
    // array of conditions. Deeper checks (known operator, resolvable field)
    // are the shared evaluator's job at run time; this just catches a
    // structurally broken value before it reaches there.
    if (data.conditions !== undefined) {
      if (!Array.isArray(data.conditions)) {
        errors.push('Conditions must be an array of condition groups')
      } else if (data.conditions.some((group) => !group || !Array.isArray(group.conditions))) {
        errors.push('Each condition group must carry an array of conditions')
      }
    }

    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    return { valid: errors.length === 0, errors, warnings }
  }
}
