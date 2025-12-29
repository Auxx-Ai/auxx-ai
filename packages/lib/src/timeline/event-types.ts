// packages/lib/src/timeline/event-types.ts

/** Entity types that can have timeline events */
export enum TimelineEntityType {
  CONTACT = 'contact',
  TICKET = 'ticket',
  THREAD = 'thread',
  ORDER = 'order',
  USER = 'user',
}

/** Prefix for custom entity types in timeline */
export const ENTITY_TYPE_PREFIX = 'entity:'

/** System entity type values */
export const SYSTEM_ENTITY_TYPES = Object.values(TimelineEntityType)

/**
 * Check if entityType is a system type (from enum)
 */
export function isSystemEntityType(entityType: string): entityType is TimelineEntityType {
  return SYSTEM_ENTITY_TYPES.includes(entityType as TimelineEntityType)
}

/**
 * Check if entityType is a custom entity (prefixed with 'entity:')
 */
export function isCustomEntityType(entityType: string): boolean {
  return entityType.startsWith(ENTITY_TYPE_PREFIX)
}

/**
 * Extract entityDefinitionId from custom entity type
 * @example getEntityDefinitionId('entity:clxyz123') => 'clxyz123'
 */
export function getEntityDefinitionId(entityType: string): string | null {
  if (!isCustomEntityType(entityType)) return null
  return entityType.slice(ENTITY_TYPE_PREFIX.length)
}

/**
 * Create custom entity type from entityDefinitionId
 * @example createCustomEntityType('clxyz123') => 'entity:clxyz123'
 */
export function createCustomEntityType(entityDefinitionId: string): string {
  return `${ENTITY_TYPE_PREFIX}${entityDefinitionId}`
}

/** Actor types for timeline events */
export enum TimelineActorType {
  USER = 'user',
  SYSTEM = 'system',
  AUTOMATION = 'automation',
  API = 'api',
  INTEGRATION = 'integration',
}

/** Contact-specific event types */
export enum ContactEventType {
  // Lifecycle
  CREATED = 'contact:created',
  UPDATED = 'contact:updated',
  MERGED = 'contact:merged',
  STATUS_CHANGED = 'contact:status:changed',

  // Relationships
  TICKET_CREATED = 'contact:ticket:created',
  TICKET_UPDATED = 'contact:ticket:updated',
  TICKET_STATUS_CHANGED = 'contact:ticket:status:changed',
  ORDER_CREATED = 'contact:order:created',
  ORDER_UPDATED = 'contact:order:updated',

  // Communication
  EMAIL_RECEIVED = 'contact:email:received',
  EMAIL_SENT = 'contact:email:sent',
  NOTE_ADDED = 'contact:note:added',
  NOTE_UPDATED = 'contact:note:updated',
  NOTE_DELETED = 'contact:note:deleted',

  // Organization
  GROUP_ADDED = 'contact:group:added',
  GROUP_REMOVED = 'contact:group:removed',
  TAG_ADDED = 'contact:tag:added',
  TAG_REMOVED = 'contact:tag:removed',

  // Custom fields
  FIELD_UPDATED = 'contact:field:updated',

  // Assignment
  ASSIGNED = 'contact:assigned',
  UNASSIGNED = 'contact:unassigned',
}

/** Ticket-specific event types */
export enum TicketEventType {
  // Lifecycle
  CREATED = 'ticket:created',
  UPDATED = 'ticket:updated',
  STATUS_CHANGED = 'ticket:status:changed',
  PRIORITY_CHANGED = 'ticket:priority:changed',
  TYPE_CHANGED = 'ticket:type:changed',

  // Assignment
  ASSIGNED = 'ticket:assigned',
  UNASSIGNED = 'ticket:unassigned',

  // Communication
  MESSAGE_RECEIVED = 'ticket:message:received',
  MESSAGE_SENT = 'ticket:message:sent',
  REPLY_SENT = 'ticket:reply:sent',
  NOTE_ADDED = 'ticket:note:added',
  NOTE_UPDATED = 'ticket:note:updated',
  NOTE_DELETED = 'ticket:note:deleted',

  // Relationships
  MERGED = 'ticket:merged',
  LINKED = 'ticket:linked',
  UNLINKED = 'ticket:unlinked',

  // Organization
  TAG_ADDED = 'ticket:tag:added',
  TAG_REMOVED = 'ticket:tag:removed',

  // Custom fields
  FIELD_UPDATED = 'ticket:field:updated',

  // Workflow
  WORKFLOW_TRIGGERED = 'ticket:workflow:triggered',
  WORKFLOW_COMPLETED = 'ticket:workflow:completed',
}

/** Custom Entity event types (dynamic entities) */
export enum EntityInstanceEventType {
  // Lifecycle
  CREATED = 'entity:created',
  UPDATED = 'entity:updated',
  DELETED = 'entity:deleted',
  ARCHIVED = 'entity:archived',
  RESTORED = 'entity:restored',

  // Fields
  FIELD_UPDATED = 'entity:field:updated',

  // Comments
  NOTE_ADDED = 'entity:note:added',
  NOTE_UPDATED = 'entity:note:updated',
  NOTE_DELETED = 'entity:note:deleted',

  // Workflow
  WORKFLOW_TRIGGERED = 'entity:workflow:triggered',
  WORKFLOW_COMPLETED = 'entity:workflow:completed',
}

/** All timeline event types (expandable for other entities) */
export type TimelineEventType = ContactEventType | TicketEventType | EntityInstanceEventType | string
