// apps/web/src/components/workflow/nodes/core/answer/schema.ts

import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { BaseType } from '~/components/workflow/types/variable-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import type { AnswerNodeData } from './types'

/**
 * Zod schema for answer node data (flattened structure)
 */
export const answerNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  description: z.string().optional(),
  messageType: z.enum(['new', 'reply']).default('reply'),
  integrationId: z.string().optional(),
  resourceType: z.enum(['thread', 'message']).optional(),
  resourceId: z.string().optional(),
  to: z.array(z.string()).optional(),
  toModes: z.array(z.boolean()).optional(),
  cc: z.array(z.string()).optional(),
  ccModes: z.array(z.boolean()).optional(),
  bcc: z.array(z.string()).optional(),
  bccModes: z.array(z.boolean()).optional(),
  text: z.string().min(1),
  subject: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  attachmentFiles: z.array(z.string()).optional(),
  attachmentFilesModes: z.array(z.boolean()).optional(),
})

/**
 * Default configuration for new answer nodes
 */
export const answerDefaultData: Partial<AnswerNodeData> = {
  title: 'Send Message',
  desc: 'Reply to customer',
  messageType: 'reply',
  text: '',
  to: [],
  toModes: [],
  cc: [],
  ccModes: [],
  bcc: [],
  bccModes: [],
  subject: '',
  attachments: [],
  attachmentFiles: [],
  attachmentFilesModes: [],
}

/**
 * Validation function for answer configuration
 */
export const validateAnswerConfig = (data: AnswerNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate text content
  if (!data.text?.trim()) {
    errors.push({ field: 'text', message: 'Message content is required', type: 'error' })
  }

  // Validate messageType-specific requirements
  if (data.messageType === 'new') {
    // For new messages, integration is required
    if (!data.integrationId) {
      errors.push({
        field: 'integrationId',
        message: 'Integration is required for new messages',
        type: 'error',
      })
    }
  } else if (data.messageType === 'reply') {
    // For replies, resourceId is required
    if (!data.resourceId) {
      errors.push({
        field: 'resourceId',
        message: 'Reply target (thread or message) is required',
        type: 'error',
      })
    }
    // resourceType is required for replies
    if (!data.resourceType) {
      errors.push({
        field: 'resourceType',
        message: 'Resource type (thread or message) is required for replies',
        type: 'error',
      })
    }
  }

  // Validate that at least one 'to' recipient is provided
  if (!data.to || data.to.length === 0) {
    errors.push({
      field: 'to',
      message: 'At least one recipient is required',
      type: 'error',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Define output variables for answer node
 */
const getAnswerOutputVariables = (data: AnswerNodeData, nodeId: string): any[] => {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'sent',
      type: BaseType.BOOLEAN,
      description: 'Whether the message was sent successfully',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'message_id',
      type: BaseType.STRING,
      description: 'ID of the sent message',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'thread_id',
      type: BaseType.STRING,
      description: 'ID of the email thread',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'timestamp',
      type: BaseType.DATETIME,
      description: 'Timestamp when the message was sent',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'integration_id',
      type: BaseType.STRING,
      description: 'ID of the integration used to send',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'message_type',
      type: BaseType.STRING,
      description: 'Type of message sent (new or reply)',
    }),
  ]
}

export function extractAnswerVariables(data: AnswerNodeData): string[] {
  const uniqueVariables = new Set<string>()

  // Extract from text field (rich editor content)
  if (data.text) {
    extractVarIdsFromString(data.text).forEach((varId) => uniqueVariables.add(varId))
  }

  // Extract from subject
  if (data.subject) {
    extractVarIdsFromString(data.subject).forEach((varId) => uniqueVariables.add(varId))
  }

  // Extract from email arrays
  if (data.to && Array.isArray(data.to)) {
    data.to.forEach((email) => {
      extractVarIdsFromString(email).forEach((varId) => uniqueVariables.add(varId))
    })
  }
  if (data.cc && Array.isArray(data.cc)) {
    data.cc.forEach((email) => {
      extractVarIdsFromString(email).forEach((varId) => uniqueVariables.add(varId))
    })
  }
  if (data.bcc && Array.isArray(data.bcc)) {
    data.bcc.forEach((email) => {
      extractVarIdsFromString(email).forEach((varId) => uniqueVariables.add(varId))
    })
  }

  // Extract from resourceId for replies
  if (data.resourceId) {
    extractVarIdsFromString(data.resourceId).forEach((varId) => uniqueVariables.add(varId))
  }

  // Extract from attachment files
  if (data.attachmentFiles && Array.isArray(data.attachmentFiles)) {
    data.attachmentFiles.forEach((file) => {
      extractVarIdsFromString(file).forEach((varId) => uniqueVariables.add(varId))
    })
  }

  return Array.from(uniqueVariables)
}

/**
 * Node definition for answer
 */
export const answerDefinition: NodeDefinition<AnswerNodeData> = {
  id: NodeType.ANSWER,
  category: NodeCategory.ACTION,
  displayName: 'Send Answer',
  description: 'Send reply to customer email',
  icon: 'send',
  color: '#10b981', // ACTION category color
  defaultData: answerDefaultData,
  schema: answerNodeDataSchema,
  validator: validateAnswerConfig,
  canRunSingle: true,
  extractVariables: extractAnswerVariables,
  outputVariables: getAnswerOutputVariables as any,
}
