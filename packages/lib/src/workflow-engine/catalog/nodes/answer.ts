// packages/lib/src/workflow-engine/catalog/nodes/answer.ts

import { z } from 'zod'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { extractVarIdsFromString } from '../variable-inference'

/**
 * The answer node's catalog manifest — sends a new message or replies on a
 * thread through a channel integration.
 */

/**
 * Node data for answer nodes with flattened structure
 */
export interface AnswerNodeData extends BaseNodeData {
  // 'new' = compose fresh email, 'reply' = reply to sender, 'replyAll' = reply to all
  messageType: 'new' | 'reply' | 'replyAll'

  integrationId?: string // Required for 'new', auto-derived for reply/replyAll
  recordId?: string // Format: "entityDefinitionId:id" (e.g. "thread:abc123", "message:xyz789")
  // Required for reply/replyAll. Replaces old resourceId + resourceType.

  // Per-field auto-resolve toggles (reply/replyAll only, ignored for 'new')
  // true (default): system auto-resolves from thread at execution time
  // false: user provides the value explicitly
  toIsAuto?: boolean
  ccIsAuto?: boolean
  bccIsAuto?: boolean
  subjectIsAuto?: boolean

  to?: string[]
  toModes?: boolean[]
  cc?: string[]
  ccModes?: boolean[]
  bcc?: string[]
  bccModes?: boolean[]
  text: string
  subject?: string
  /**
   * Attachment picker rows — a constant row is a `file:<id>` reference, a
   * variable row a `{{…}}` reference. `attachmentFilesModes` marks which is
   * which, positionally. The engine resolves both to file ids and hands them to
   * the send path as `attachmentIds`.
   */
  attachmentFiles?: string[]
  attachmentFilesModes?: boolean[]
  saveAsDraft?: boolean // When true, creates a draft instead of sending
  // Per-node send behavior override: default = dry-run during test runs,
  // live = always send, dry_run = never send, draft = save as thread draft
  test_behavior?: 'default' | 'live' | 'dry_run' | 'draft'
  fieldModes?: Record<string, boolean> // Track constant/variable mode per field
}

/**
 * Zod schema for answer node data (flattened structure).
 *
 * `text` tolerates the empty string a fresh node persists — required-ness is
 * the validator's "Message content is required" check, same as the list node's
 * `inputList` (the defaults must parse their own schema).
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
  text: z.string(),
  subject: z.string().optional(),
  attachmentFiles: z.array(z.string()).optional(),
  attachmentFilesModes: z.array(z.boolean()).optional(),
  saveAsDraft: z.boolean().optional(),
  test_behavior: z.enum(['default', 'live', 'dry_run', 'draft']).optional(),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Validation function for answer configuration
 */
export const validateAnswerConfig = (data: AnswerNodeData): NodeValidationResult => {
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

/** Extract referenced variable IDs from answer node data */
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
 * Answer node manifest
 */
export const answerManifest: NodeManifest<AnswerNodeData> = {
  id: 'answer',
  category: NodeCategory.ACTION,
  displayName: 'Send Answer',
  description: 'Send reply to customer email',
  icon: 'send',
  color: '#10b981', // ACTION category color
  defaultData: () => ({
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
    attachmentFiles: [],
    attachmentFilesModes: [],
    saveAsDraft: false,
    test_behavior: 'default',
  }),
  configSchema: answerNodeDataSchema as unknown as z.ZodType<AnswerNodeData>,
  validate: validateAnswerConfig,
  extractVariables: extractAnswerVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      "`messageType: 'reply'` needs `recordId` (a thread/message ref, usually a bare variable path " +
      "like `trigger-1.thread`); 'new' needs `integrationId` plus explicit `to`. Recipients/subject " +
      'auto-resolve from the thread while the `*IsAuto` flags stay true — only set them false to ' +
      'override. `text` is the message body and may contain {{…}} refs. `test_behavior` defaults to ' +
      'dry-run during builder test runs.',
    examples: [
      {
        description: 'Reply on the triggering thread with an AI draft',
        config: {
          messageType: 'reply',
          recordId: 'trigger-1.thread',
          text: '{{ai-1.text}}',
        },
      },
    ],
  },
}
