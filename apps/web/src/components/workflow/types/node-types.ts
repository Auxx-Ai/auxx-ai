// apps/web/src/components/workflow/types/node-types.ts
// import { WorkflowNodeType } from '@auxx/lib/workflow-engine/types'
/**
 * Centralized enum for all workflow node types
 * Use this enum instead of string literals throughout the codebase
 */
export enum NodeType {
  // Trigger nodes
  MESSAGE_RECEIVED = 'message-received-trigger',
  WEBHOOK = 'webhook-trigger',
  SCHEDULED = 'scheduled-trigger',
  MANUAL = 'manual-trigger',
  RESOURCE_TRIGGER = 'resource-trigger', // Unified resource trigger

  // Resource trigger nodes (legacy - kept for backwards compatibility)
  CONTACT_CREATED_TRIGGER = 'contact-created-trigger',
  CONTACT_UPDATED_TRIGGER = 'contact-updated-trigger',
  CONTACT_DELETED_TRIGGER = 'contact-deleted-trigger',
  TICKET_CREATED_TRIGGER = 'ticket-created-trigger',
  TICKET_UPDATED_TRIGGER = 'ticket-updated-trigger',
  TICKET_DELETED_TRIGGER = 'ticket-deleted-trigger',

  // Input nodes
  FORM_INPUT = 'form-input',
  TEXT_INPUT = 'text-input',
  NUMBER_INPUT = 'number-input',
  FILE_UPLOAD = 'file-upload',

  // Condition nodes
  IF_ELSE = 'if-else',

  // Action nodes
  ANSWER = 'answer',
  AI = 'ai',
  FIND = 'find',
  HTTP = 'http',
  CRUD = 'crud',
  PROFESSIONAL_NETWORK = 'professional-network',
  DOCUMENT_EXTRACTOR = 'document-extractor',
  CHUNKER = 'chunker',
  DATASET = 'dataset',
  KNOWLEDGE_RETRIEVAL = 'knowledge-retrieval',

  // Transform nodes
  CODE = 'code',
  TEXT_CLASSIFIER = 'text-classifier',
  INFORMATION_EXTRACTOR = 'information-extractor',
  VAR_ASSIGN = 'var-assign',
  DATE_TIME = 'date-time',
  LIST = 'list',

  // Data nodes
  // VARIABLE = 'variable', // Currently commented out in registry
  NOTE = 'note',

  // Control nodes
  END = 'end',
  WAIT = 'wait',
  LOOP = 'loop',
  HUMAN_CONFIRMATION = 'human-confirmation',
}

/**
 * Type guard to check if a string is a valid NodeType
 */
export function isNodeType(type: string): type is NodeType {
  return Object.values(NodeType).includes(type as NodeType)
}

/**
 * Get display name for a node type
 */
export function getNodeTypeDisplayName(type: NodeType): string {
  const displayNames: Record<NodeType, string> = {
    [NodeType.MESSAGE_RECEIVED]: 'Message Received',
    [NodeType.WEBHOOK]: 'Webhook',
    [NodeType.SCHEDULED]: 'Scheduled Trigger',
    [NodeType.MANUAL]: 'Manual Trigger',
    [NodeType.RESOURCE_TRIGGER]: 'Resource',
    [NodeType.CONTACT_CREATED_TRIGGER]: 'Contact Created',
    [NodeType.CONTACT_UPDATED_TRIGGER]: 'Contact Updated',
    [NodeType.CONTACT_DELETED_TRIGGER]: 'Contact Deleted',
    [NodeType.TICKET_CREATED_TRIGGER]: 'Ticket Created',
    [NodeType.TICKET_UPDATED_TRIGGER]: 'Ticket Updated',
    [NodeType.TICKET_DELETED_TRIGGER]: 'Ticket Deleted',
    [NodeType.FORM_INPUT]: 'Form Input',
    [NodeType.TEXT_INPUT]: 'Text Input',
    [NodeType.NUMBER_INPUT]: 'Number Input',
    [NodeType.FILE_UPLOAD]: 'File Upload',
    [NodeType.IF_ELSE]: 'IF/ELSE',
    [NodeType.ANSWER]: 'Answer',
    [NodeType.AI]: 'AI',
    [NodeType.FIND]: 'Find',
    [NodeType.HTTP]: 'HTTP Request',
    [NodeType.CRUD]: 'CRUD',
    [NodeType.PROFESSIONAL_NETWORK]: 'Professional Network',
    [NodeType.DOCUMENT_EXTRACTOR]: 'Document Extractor',
    [NodeType.CHUNKER]: 'Chunker',
    [NodeType.DATASET]: 'Dataset',
    [NodeType.KNOWLEDGE_RETRIEVAL]: 'Knowledge Retrieval',
    [NodeType.CODE]: 'Code',
    [NodeType.TEXT_CLASSIFIER]: 'Text Classifier',
    [NodeType.INFORMATION_EXTRACTOR]: 'Information Extractor',
    [NodeType.VAR_ASSIGN]: 'Assign Variable',
    [NodeType.DATE_TIME]: 'Date Time',
    [NodeType.LIST]: 'List Operations',
    [NodeType.NOTE]: 'Note',
    [NodeType.END]: 'End',
    [NodeType.WAIT]: 'Wait',
    [NodeType.LOOP]: 'Loop',
    [NodeType.HUMAN_CONFIRMATION]: 'Human Confirmation',
  }
  return displayNames[type] || type
}
