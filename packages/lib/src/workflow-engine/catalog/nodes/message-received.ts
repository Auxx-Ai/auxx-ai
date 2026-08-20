// packages/lib/src/workflow-engine/catalog/nodes/message-received.ts

import { z } from 'zod'
import { type ConditionGroup, conditionGroupsSchema } from '../../../conditions/client'
import { BaseType, WorkflowTriggerType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createNestedVariable, createUnifiedOutputVariable } from '../variable-conversion'

/**
 * The message-received node's catalog manifest. Carries the #1555 scoping
 * fields: `channelIds` (absent/empty = fires on EVERY channel in the org —
 * allowed, but surfaced as `UNSCOPED_MESSAGE_TRIGGER_WARNING`), `conditions`
 * (the shared ConditionGroup dialect, evaluated fail-closed), and
 * `machineMail`. All three are read off the PUBLISHED graph by the
 * `triggerMessageWorkflows` dispatcher, not by the runtime node. The
 * deprecated duplicate `messageReceivedSchema` (zero consumers) was deleted.
 */

/**
 * Node data for message-received nodes (flattened structure)
 */
export interface MessageReceivedNodeData extends BaseNodeData {
  /**
   * Channel scope, which channels' inbound mail can start this workflow.
   * `undefined`/empty means **all channels** (the default, publish never
   * forces a choice). Read by the `triggerMessageWorkflows` dispatcher off the
   * published graph (`triggerNode.data.channelIds`), not by the runtime node
   * itself. The "Inboxes" picker in the panel is UI sugar only: picking an
   * inbox writes that inbox's channel ids in here.
   */
  channelIds?: string[]
  /**
   * Soft-tier machine-mail handling (out-of-office replies, mailing-list /
   * notification mail). `'exclude'` (the default when absent) skips this
   * workflow for soft machine mail; `'include'` opts it in. Read off the
   * published graph by the `triggerMessageWorkflows` dispatcher. Hard-tier
   * machine mail (bounces / delivery-failure NDRs) is always skipped
   * regardless of this setting.
   */
  machineMail?: 'exclude' | 'include'
  /**
   * Mail sent from one of the org's own connected channel addresses (any
   * channel's email or provider alias, personal mailboxes included).
   * `'include'` — the default when absent — fires the workflow: at the address
   * level a teammate mailing the shared inbox off their own connected mailbox
   * is indistinguishable from a cross-channel echo, and that mail should
   * automate like any other. `'exclude'` skips it, for a workflow that would
   * otherwise act on its own org's mail. Read off the published graph by the
   * `triggerMessageWorkflows` dispatcher. A PROVEN echo of a message this org
   * sent (`X-AuxxAi-Message-Id` resolving to our own row) is always skipped,
   * regardless of this setting.
   */
  ownAddress?: 'exclude' | 'include'
  /**
   * Content conditions, replaces the deleted "Message Filters" UI. Evaluated
   * by the engine with the shared `evaluateConditionsWithDiagnostics` against
   * message-resolvable fields (from/to/subject/body/hasAttachments).
   * Deliberately excludes `channel`/`isInbound`, channel scoping lives only
   * in `channelIds` above. Undefined/empty means "runs on every message".
   */
  conditions?: ConditionGroup[]
}

/**
 * Zod schema for message-received node data (flattened structure)
 */
export const messageReceivedNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal('message-received'),
  // .default(false) aligns with baseNodeDataSchema — the node factory sets it
  selected: z.boolean().default(false),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  variables: z.array(z.any()).optional(),
  channelIds: z.array(z.string()).optional(),
  machineMail: z.enum(['exclude', 'include']).optional(),
  ownAddress: z.enum(['exclude', 'include']).optional(),
  conditions: conditionGroupsSchema.optional(),

  // Other node data properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Warning shown (on the node badge and inline in the panel) when a trigger has
 * no channel scope. Unscoped is a valid, supported state, publish never
 * forces a choice, but it must stay visible: the dispatcher fans this
 * workflow out to every channel in the org.
 */
export const UNSCOPED_MESSAGE_TRIGGER_WARNING =
  'Unscoped: runs on every channel in the org. Select channels or an inbox under "Run on" to limit it.'

/**
 * Validation function for message-received configuration
 */
export const validateMessageReceivedConfig = (
  data: MessageReceivedNodeData
): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Support both old config format and new flattened format
  const dataToValidate = 'config' in data ? (data as any).config : data

  // Validate title
  if (!dataToValidate.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Unscoped trigger, allowed, but must be an unmissable warning (§4).
  if (!dataToValidate.channelIds || dataToValidate.channelIds.length === 0) {
    errors.push({
      field: 'channelIds',
      message: UNSCOPED_MESSAGE_TRIGGER_WARNING,
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Define output variables for message-received node
 */
function getMessageReceivedOutputVariables(
  data: MessageReceivedNodeData,
  nodeId: string
): UnifiedVariable[] {
  // Message object with all nested properties using createNestedVariable
  const messageVariable = createNestedVariable({
    nodeId,
    basePath: 'message',
    type: BaseType.OBJECT,
    label: 'Email Message',
    description: 'The received email message object',
    properties: {
      id: {
        type: BaseType.STRING,
        description: 'Unique message identifier',
      },
      thread_id: {
        type: BaseType.STRING,
        description: 'Email thread identifier',
      },
      from: {
        type: BaseType.OBJECT,
        label: 'From',
        description: 'Sender information',
        properties: {
          email: {
            type: BaseType.EMAIL,
            description: 'Sender email address',
          },
          name: {
            type: BaseType.STRING,
            description: 'Sender display name',
          },
        },
      },
      to: {
        type: BaseType.ARRAY,
        label: 'To',
        description: 'Recipients list',
        items: {
          type: BaseType.OBJECT,
          label: 'Recipient',
          properties: {
            email: {
              type: BaseType.EMAIL,
              description: 'Recipient email address',
            },
            name: {
              type: BaseType.STRING,
              description: 'Recipient display name',
            },
          },
        },
      },
      subject: {
        type: BaseType.STRING,
        description: 'Email subject line',
      },
      body: {
        type: BaseType.STRING,
        description: 'Email body content (plain text)',
      },
      html: {
        type: BaseType.STRING,
        description: 'Email body content (HTML)',
      },
      received_at: {
        type: BaseType.DATETIME,
        description: 'Timestamp when message was received',
      },
      has_attachments: {
        type: BaseType.BOOLEAN,
        description: 'Whether the message has attachments',
      },
      attachments: {
        type: BaseType.ARRAY,
        label: 'Attachments',
        description: 'List of message attachments',
        items: {
          type: BaseType.OBJECT,
          label: 'Attachment',
          properties: {
            name: {
              type: BaseType.STRING,
              description: 'Attachment filename',
            },
            size: {
              type: BaseType.NUMBER,
              description: 'Attachment size in bytes',
            },
            type: {
              type: BaseType.STRING,
              description: 'MIME type of attachment',
            },
            url: {
              type: BaseType.URL,
              description: 'Download URL for attachment',
            },
          },
        },
      },
    },
  })

  // Thread relation, points to the thread this message belongs to
  const threadRelation = createUnifiedOutputVariable({
    nodeId,
    path: 'thread',
    type: BaseType.RELATION,
    description: 'The email thread this message belongs to',
    resourceId: 'thread',
  })

  // Message relation, points to the received message itself
  const messageRelation = createUnifiedOutputVariable({
    nodeId,
    path: 'message_ref',
    type: BaseType.RELATION,
    description: 'The received message (for replying to)',
    resourceId: 'message',
  })

  // Ticket relation, the thread's linked ticket. Empty unless the thread was
  // already linked to one: receiving mail never creates or links a ticket.
  const ticketRelation = createUnifiedOutputVariable({
    nodeId,
    path: 'ticket',
    type: BaseType.RELATION,
    label: 'Ticket',
    description: "The ticket linked to this message's thread (empty when none is linked)",
    resourceId: 'ticket',
  })

  return [messageVariable, threadRelation, messageRelation, ticketRelation]
}

/**
 * Message-received node manifest
 */
export const messageReceivedManifest: NodeManifest<MessageReceivedNodeData> = {
  id: 'message-received',
  category: NodeCategory.TRIGGER,
  displayName: 'Message Received',
  description: 'Triggers when a new message is received',
  icon: 'mail',
  color: '#10b981', // TRIGGER category color
  triggerType: WorkflowTriggerType.MESSAGE_RECEIVED,
  defaultData: () => ({
    title: 'Message Received',
    desc: 'Triggered when a new message is received',
    variables: [],
  }),
  configSchema: messageReceivedNodeDataSchema as unknown as z.ZodType<MessageReceivedNodeData>,
  validate: validateMessageReceivedConfig,
  resolveOutputs: getMessageReceivedOutputVariables,
  connection: {},
  agent: {
    authorable: true,
    usage:
      'ALWAYS scope with `channelIds` unless the user explicitly wants org-wide firing — absent or ' +
      'empty means the workflow runs on EVERY channel in the org (the validator surfaces this as a ' +
      'warning; relay it and push toward scoping). `conditions` filter on message content ' +
      '(from/to/subject/body/hasAttachments, shared ConditionGroup dialect, fail-closed); channel ' +
      "scoping lives ONLY in `channelIds`. `machineMail: 'include'` opts into soft machine mail " +
      '(out-of-office, list mail); bounces are always skipped. ' +
      "`ownAddress: 'exclude'` stops the workflow firing on mail sent from the org's own connected " +
      'channel addresses — leave it unset (defaults to include) unless the user says this workflow ' +
      "must ignore their own team's mail; echoes of mail this org sent are always skipped anyway.",
    examples: [
      {
        description: 'Fire on support-inbox mail that mentions a refund',
        config: {
          channelIds: ['channel_abc123'],
          conditions: [
            {
              id: 'g1',
              logicalOperator: 'AND',
              conditions: [
                {
                  id: 'c1',
                  fieldId: 'subject',
                  operator: 'contains',
                  value: 'refund',
                  isConstant: true,
                },
              ],
            },
          ],
        },
      },
    ],
  },
}
