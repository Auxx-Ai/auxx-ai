// apps/web/src/components/workflow/nodes/core/message-received/schema.ts

import { messageReceivedManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { BaseType, type UnifiedVariable } from '../../../types/variable-types'
import {
  createNestedVariable,
  createUnifiedOutputVariable,
} from '../../../utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { MessageReceivedNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, the
// unscoped-trigger warning) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/message-received`). This file is
// the merge site: manifest + the web-only output resolver.

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

/** Node definition for message-received */
export const messageReceivedDefinition: NodeDefinition<MessageReceivedNodeData> =
  defineFromManifest(messageReceivedManifest as unknown as NodeManifest<MessageReceivedNodeData>, {
    outputVariables: getMessageReceivedOutputVariables as any,
  })

// Back-compat re-exports so no panel or consumer import churns:
export {
  messageReceivedNodeDataSchema,
  UNSCOPED_MESSAGE_TRIGGER_WARNING,
  validateMessageReceivedConfig,
} from '@auxx/lib/workflow-engine/client'

/** Default data for new message-received nodes (flattened) */
export const messageReceivedDefaultData =
  messageReceivedManifest.defaultData() as Partial<MessageReceivedNodeData>
