// apps/web/src/components/workflow/types/node-types.ts
// import { WorkflowNodeType } from '@auxx/lib/workflow-engine/client'
/**
 * Centralized enum for all workflow node types
 * Use this enum instead of string literals throughout the codebase
 */
export enum NodeType {
  // Trigger nodes - aligned with backend WorkflowTriggerType
  MESSAGE_RECEIVED = 'message-received',
  WEBHOOK = 'webhook',
  WEBHOOK_ENDPOINT = 'webhook-endpoint', // Inbound WebhookEndpoint trigger
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
  RESOURCE_TRIGGER = 'resource-trigger', // Unified resource trigger

  // Input nodes
  FORM_INPUT = 'form-input',

  // Condition nodes
  IF_ELSE = 'if-else',

  // Action nodes
  ANSWER = 'answer',
  AI = 'ai',
  FIND = 'find',
  HTTP = 'http',
  CRUD = 'crud',
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
  FORMAT = 'format',

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
    [NodeType.WEBHOOK_ENDPOINT]: 'Webhook Endpoint',
    [NodeType.SCHEDULED]: 'Scheduled Trigger',
    [NodeType.MANUAL]: 'Manual Trigger',
    [NodeType.RESOURCE_TRIGGER]: 'Resource',
    [NodeType.FORM_INPUT]: 'Form Input',
    [NodeType.IF_ELSE]: 'IF/ELSE',
    [NodeType.ANSWER]: 'Answer',
    [NodeType.AI]: 'AI',
    [NodeType.FIND]: 'Find',
    [NodeType.HTTP]: 'HTTP Request',
    [NodeType.CRUD]: 'CRUD',
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
    [NodeType.FORMAT]: 'Format',
    [NodeType.NOTE]: 'Note',
    [NodeType.END]: 'End',
    [NodeType.WAIT]: 'Wait',
    [NodeType.LOOP]: 'Loop',
    [NodeType.HUMAN_CONFIRMATION]: 'Human Confirmation',
  }
  return displayNames[type] || type
}
