// apps/web/src/components/workflow/nodes/core/message-received/schema.ts

import { conditionGroupsSchema } from '@auxx/lib/conditions/client'
import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  NodeType,
  type ValidationResult,
} from '~/components/workflow/types'
import { BaseType, type UnifiedVariable } from '../../../types/variable-types'
import {
  createNestedVariable,
  createUnifiedOutputVariable,
} from '../../../utils/variable-conversion'
import type { MessageReceivedNodeData } from './types'

/**
 * Zod schema for message-received configuration
 * @deprecated Use messageReceivedNodeDataSchema instead
 */
export const messageReceivedSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})

/**
 * Zod schema for message-received node data (flattened structure)
 */
export const messageReceivedNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal(NodeType.MESSAGE_RECEIVED),
  selected: z.boolean(),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),
  variables: z.array(z.any()).optional(),
  channelIds: z.array(z.string()).optional(),
  machineMail: z.enum(['exclude', 'include']).optional(),
  conditions: conditionGroupsSchema.optional(),

  // Other node data properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Default data for new message-received nodes (flattened)
 */
export const messageReceivedDefaultData: Partial<MessageReceivedNodeData> = {
  title: 'Message Received',
  desc: 'Triggered when a new message is received',
  variables: [],
}

/**
 * Warning shown (on the node badge and inline in the panel) when a trigger has
 * no channel scope. Unscoped is a valid, supported state — publish never
 * forces a choice — but it must stay visible: the dispatcher fans this
 * workflow out to every channel in the org.
 */
export const UNSCOPED_MESSAGE_TRIGGER_WARNING =
  'Unscoped — runs on every channel in the org. Select channels or an inbox under "Run on" to limit it.'

/**
 * Validation function for message-received configuration
 */
export const validateMessageReceivedConfig = (data: MessageReceivedNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Support both old config format and new flattened format
  const dataToValidate = 'config' in data ? (data as any).config : data

  // Validate title
  if (!dataToValidate.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Unscoped trigger — allowed, but must be an unmissable warning (§4).
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
 * Node definition for message-received
 */
export const messageReceivedDefinition: NodeDefinition<MessageReceivedNodeData> = {
  id: NodeType.MESSAGE_RECEIVED,
  category: NodeCategory.TRIGGER,
  displayName: 'Message Received',
  description: 'Triggers when a new message is received',
  icon: 'mail',
  color: '#10b981', // TRIGGER category color
  defaultData: messageReceivedDefaultData,
  schema: messageReceivedNodeDataSchema,
  validator: validateMessageReceivedConfig as any,
  triggerType: WorkflowTriggerType.MESSAGE_RECEIVED,
  outputVariables: getMessageReceivedOutputVariables as any,
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

  // Thread relation — points to the thread this message belongs to
  const threadRelation = createUnifiedOutputVariable({
    nodeId,
    path: 'thread',
    type: BaseType.RELATION,
    description: 'The email thread this message belongs to',
    resourceId: 'thread',
  })

  // Message relation — points to the received message itself
  const messageRelation = createUnifiedOutputVariable({
    nodeId,
    path: 'message_ref',
    type: BaseType.RELATION,
    description: 'The received message (for replying to)',
    resourceId: 'message',
  })

  // Ticket relation — the thread's linked ticket. Empty unless the thread was
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
