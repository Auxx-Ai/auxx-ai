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
  messageType: z.enum(['new', 'reply', 'replyAll']).default('reply'),
  integrationId: z.string().optional(),
  recordId: z.string().optional(),
  toIsAuto: z.boolean().optional(),
  ccIsAuto: z.boolean().optional(),
  bccIsAuto: z.boolean().optional(),
  subjectIsAuto: z.boolean().optional(),
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
  toIsAuto: true,
  ccIsAuto: true,
  bccIsAuto: true,
  subjectIsAuto: true,
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

  const isReply = data.messageType === 'reply' || data.messageType === 'replyAll'

  if (data.messageType === 'new') {
    // For new messages, integration is required
    if (!data.integrationId) {
      errors.push({
        field: 'integrationId',
        message: 'Integration is required for new messages',
        type: 'error',
      })
    }
    // To and Subject always required for new messages
    if (!data.to || data.to.length === 0) {
      errors.push({ field: 'to', message: 'At least one recipient is required', type: 'error' })
    }
  } else if (isReply) {
    // recordId is always required for replies
    if (!data.recordId) {
      errors.push({
        field: 'recordId',
        message: 'Reply target is required',
        type: 'error',
      })
    }
    // To only required when not auto-resolved
    if (data.toIsAuto === false && (!data.to || data.to.length === 0)) {
      errors.push({ field: 'to', message: 'At least one recipient is required', type: 'error' })
    }
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
      description: 'Type of message sent (new, reply, or replyAll)',
    }),
  ]
}

export function extractAnswerVariables(data: AnswerNodeData): string[] {
  const uniqueVariables = new Set<string>()

  // Extract from text field (rich editor content)
  if (data.text) {
    extractVarIdsFromString(data.text).forEach((varId) => uniqueVariables.add(varId))
  }

  // Extract from subject (only when not auto-resolved)
  if (data.subject && data.subjectIsAuto === false) {
    extractVarIdsFromString(data.subject).forEach((varId) => uniqueVariables.add(varId))
  }

  // Extract from email arrays (only when not auto-resolved)
  if (data.toIsAuto === false && data.to && Array.isArray(data.to)) {
    data.to.forEach((email) => {
      extractVarIdsFromString(email).forEach((varId) => uniqueVariables.add(varId))
    })
  }
  if (data.ccIsAuto === false && data.cc && Array.isArray(data.cc)) {
    data.cc.forEach((email) => {
      extractVarIdsFromString(email).forEach((varId) => uniqueVariables.add(varId))
    })
  }
  if (data.bccIsAuto === false && data.bcc && Array.isArray(data.bcc)) {
    data.bcc.forEach((email) => {
      extractVarIdsFromString(email).forEach((varId) => uniqueVariables.add(varId))
    })
  }

  // Extract from recordId for replies (PICKER mode stores raw variable ID, not {{...}} wrapped)
  if (data.recordId) {
    const extracted = extractVarIdsFromString(data.recordId)
    if (extracted.length > 0) {
      extracted.forEach((varId) => uniqueVariables.add(varId))
    } else if (data.recordId.includes('.')) {
      // Raw variable ID from PICKER mode (e.g. "nodeId.thread")
      uniqueVariables.add(data.recordId)
    }
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
