// packages/lib/src/field-triggers/types.ts

import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'

/** Fired when a field with a registered trigger has its value changed */
export interface FieldTriggerEvent {
  action: 'updated'
  systemAttribute: SystemAttribute
  recordIds: RecordId[]
  organizationId: string
  userId: string
}

/** Fired when an entity of a registered type is created or deleted */
export interface EntityTriggerEvent {
  action: 'created' | 'deleted'
  entitySlug: string
  entityType: string
  entityDefinitionId: string
  entityInstanceId: string
  organizationId: string
  userId: string
  values: Record<string, unknown>
}

/** Async handler for field value change triggers */
export type FieldTriggerHandler = (event: FieldTriggerEvent) => Promise<void>

/** Async handler for entity lifecycle triggers */
export type EntityTriggerHandler = (event: EntityTriggerEvent) => Promise<void>
