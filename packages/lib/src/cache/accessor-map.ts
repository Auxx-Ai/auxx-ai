// packages/lib/src/cache/accessor-map.ts

import type { CustomFieldEntity, OrganizationRole } from '@auxx/database/types'
import type { Inbox } from '../inboxes/types'
import type { Overage } from '../permissions/overage-detection-service'
import type { FeatureMapObject } from '../permissions/types'
import type { ResourceField } from '../resources/registry/field-types'
import type { Resource } from '../resources/registry/types'
import type {
  ArrayAccessor,
  NestedRecordAccessor,
  RecordAccessor,
  ScalarAccessor,
} from './accessors'
import type { CachedSubscription, DehydratedOrgProfile, OrgMemberInfo } from './org-cache-keys'
import type { CachedWorkflowApp } from './providers/workflow-apps-provider'

/**
 * Maps each cache key to its accessor type.
 * This drives the return type of orgCache.from(orgId, key).
 */
export interface OrgCacheAccessorMap {
  // Array-shaped
  resources: ResourceAccessor
  members: ArrayAccessor<OrgMemberInfo>
  inboxes: ArrayAccessor<Inbox>
  overages: ArrayAccessor<Overage>

  // Record-shaped
  entityDefs: RecordAccessor<string>
  entityDefSlugs: RecordAccessor<string>
  memberRoleMap: RecordAccessor<OrganizationRole>
  channelProviders: RecordAccessor<string>
  features: ScalarAccessor<FeatureMapObject>

  // Nested record
  customFields: CustomFieldAccessor

  // Scalar
  systemUser: ScalarAccessor<string>
  subscription: ScalarAccessor<CachedSubscription | null>
  orgProfile: ScalarAccessor<DehydratedOrgProfile>

  // Custom accessor (provider-defined)
  workflowApps: WorkflowAppsAccessor
}

/** Resource accessor — ArrayAccessor + custom sugar methods */
export interface ResourceAccessor extends ArrayAccessor<Resource> {
  /** Find resource by apiSlug (e.g., 'contacts', 'tickets') */
  bySlug(slug: string): Promise<Resource | null>
  /** Get fields for a specific resource */
  fieldsFor(resourceId: string): Promise<ResourceField[]>
}

/** CustomField accessor — NestedRecordAccessor + custom sugar methods */
export interface CustomFieldAccessor extends NestedRecordAccessor<CustomFieldEntity> {
  /** Scope to entity, then find by systemAttribute */
  in(entityDefId: string): CustomFieldGroupAccessor
  /** Deep search by systemAttribute across all entities */
  bySystemAttribute(attr: string): Promise<CustomFieldEntity | null>
  /** Deep search by field ID across all entities */
  byId(fieldId: string): Promise<CustomFieldEntity | null>
}

export interface CustomFieldGroupAccessor extends ArrayAccessor<CustomFieldEntity> {
  /** Find field by systemAttribute within this entity */
  bySystemAttribute(attr: string): Promise<CustomFieldEntity | null>
}

/** WorkflowApps accessor — ArrayAccessor + trigger matching + list view sugar methods */
export interface WorkflowAppsAccessor extends ArrayAccessor<CachedWorkflowApp> {
  /** Find enabled apps matching trigger criteria */
  byTrigger(triggerType: string, entityDefinitionId?: string): Promise<CachedWorkflowApp[]>
  /** Find enabled app by ID */
  byAppId(workflowAppId: string): Promise<CachedWorkflowApp | null>
  /** Find enabled apps matching app trigger fields */
  byAppTrigger(params: {
    appId: string
    triggerId: string
    installationId: string
    connectionId?: string
  }): Promise<CachedWorkflowApp[]>
  /** List workflow apps with filtering, sorting, and pagination for the list view */
  list(filters?: {
    search?: string
    triggerType?: string
    enabled?: boolean
    limit?: number
    offset?: number
  }): Promise<{ workflows: CachedWorkflowApp[]; total: number; hasMore: boolean }>
}
