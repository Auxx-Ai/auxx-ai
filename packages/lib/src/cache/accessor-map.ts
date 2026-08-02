// packages/lib/src/cache/accessor-map.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import type { Inbox } from '../inboxes/types'
import type { CachedMailFilter } from '../mail-filters/types'
import type { Overage } from '../permissions/overage-detection-service'
import type { FeatureMapObject } from '../permissions/types'
import type { CachedRecordRule } from '../record-rules/types'
import type { ResourceField } from '../resources/registry/field-types'
import type { Resource } from '../resources/registry/types'
import type {
  ArrayAccessor,
  NestedRecordAccessor,
  RecordAccessor,
  ScalarAccessor,
} from './accessors'
import type {
  CachedSubscription,
  DehydratedOrgProfile,
  MemberRoleEntry,
  OrgMemberInfo,
} from './org-cache-keys'
import type { CachedWorkflowApp } from './providers/workflow-apps-provider'

/**
 * Maps each cache key to its accessor type.
 * This drives the return type of orgCache.from(orgId, key).
 *
 * NOTE: this is a strict SUBSET of {@link OrgCacheKeyName} — `from()` is typed
 * against `keyof OrgCacheAccessorMap`, so only the keys listed here are
 * reachable through the fluent accessor. Every other key is read with
 * `getOrgCache().get(orgId, key)`. Adding a key here also means adding it to
 * the shape lists in `OrgCacheService.createDefaultAccessor` (or giving its
 * provider a `createAccessor`), otherwise the declared accessor and the one
 * constructed at runtime disagree.
 */
export interface OrgCacheAccessorMap {
  // Array-shaped
  resources: ResourceAccessor
  members: ArrayAccessor<OrgMemberInfo>
  inboxes: ArrayAccessor<Inbox>

  // `Overage` is keyed by `key`, not `id`, so it cannot back an ArrayAccessor
  // (whose `byId` would always miss). Exposed as the whole array instead.
  overages: ScalarAccessor<Overage[]>

  // Record-shaped
  entityDefs: RecordAccessor<string>
  entityDefSlugs: RecordAccessor<string>
  memberRoleMap: RecordAccessor<MemberRoleEntry>
  channelProviders: RecordAccessor<string>
  features: ScalarAccessor<FeatureMapObject>

  // Nested record
  customFields: CustomFieldAccessor

  // Scalar
  systemUser: ScalarAccessor<string>
  hasPermissionGrants: ScalarAccessor<boolean>
  restrictedEntityDefIds: ScalarAccessor<string[]>
  governingInstanceIds: ScalarAccessor<string[]>
  subscription: ScalarAccessor<CachedSubscription | null>
  orgProfile: ScalarAccessor<DehydratedOrgProfile>

  // Custom accessor (provider-defined)
  workflowApps: WorkflowAppsAccessor

  // Record rules — plain array, dispatch filters in memory
  recordRules: ArrayAccessor<CachedRecordRule>

  // Mail filters — plain array (enabled + disabled), the gate filters by inbox in memory
  mailFilters: ArrayAccessor<CachedMailFilter>
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
  /** Batch resolve multiple systemAttributes in a single pass. Returns a map keyed by attribute. */
  bySystemAttributes<T extends string>(attrs: T[]): Promise<Record<T, CustomFieldEntity | null>>
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
  /** Find enabled apps matching a webhook-endpoint trigger `(endpointId, topic)` */
  byWebhookEndpoint(params: { endpointId: string; topic: string }): Promise<CachedWorkflowApp[]>
  /** List workflow apps with filtering, sorting, and pagination for the list view */
  list(filters?: {
    search?: string
    triggerType?: string
    enabled?: boolean
    limit?: number
    offset?: number
  }): Promise<{ workflows: CachedWorkflowApp[]; total: number; hasMore: boolean }>
}
