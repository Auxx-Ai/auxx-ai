// apps/web/src/components/workflow/nodes/core/message-received/schema.ts

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  NodeType,
  type ValidationResult,
} from '~/components/workflow/types'
import { BaseType, type UnifiedVariable } from '../../../types/variable-types'
import { createNestedVariable } from '../../../utils/variable-conversion'
import { MessageReceivedPanel } from './panel'
import type { MessageReceivedNodeData } from './types'

/**
 * Zod schema for message-received configuration
 * @deprecated Use messageReceivedNodeDataSchema instead
 */
export const messageReceivedSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  filters: z
    .object({
      from: z.array(z.string()).optional(),
      subject_contains: z.array(z.string()).optional(),
      body_contains: z.array(z.string()).optional(),
    })
    .optional(),
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
  filters: z
    .object({
      from: z.array(z.string()).optional(),
      subject_contains: z.array(z.string()).optional(),
      body_contains: z.array(z.string()).optional(),
    })
    .optional(),
  message_filter: z
    .object({
      enabled: z.boolean(),
      conditions: z.array(
        z.object({
          field: z.enum(['from', 'subject', 'body']),
          operator: z.enum(['contains', 'equals', 'regex']),
          value: z.string(),
        })
      ),
    })
    .optional(),

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
  filters: { from: [], subject_contains: [], body_contains: [] },
}

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

  // Validate email addresses in filters
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (dataToValidate.filters?.from && dataToValidate.filters.from.length > 0) {
    dataToValidate.filters.from.forEach((email: string, index: number) => {
      if (!emailRegex.test(email)) {
        errors.push({
          field: `filters.from.${index}`,
          message: `Invalid email address: ${email}`,
          type: 'error',
        })
      }
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
  panel: MessageReceivedPanel,
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

  // Return the message variable - createNestedVariable handles all the nested paths correctly
  return [messageVariable]
}
