// packages/lib/src/resources/registry/types.ts

import type { JoinScopingConfig } from './display-config'
import { RESOURCE_TABLE_REGISTRY, type TableId } from './field-registry'
import type { ResourceField } from './field-types'

/**
 * Entity definition UUID (custom resource ID, e.g., 'cm1234abc567def890...')
 * No entity_ prefix - this is the raw UUID
 */
export type EntityDefinitionId = string & { readonly __brand: 'EntityDefinitionId' }

/** Custom resource ID is now just the UUID (EntityDefinitionId) */
export type CustomResourceId = EntityDefinitionId

/** Any resource ID (system or custom) */
export type ResourceId = TableId | CustomResourceId

/** Base resource fields shared by both types */
interface BaseResource {
  id: string
  label: string
  plural: string
  icon: string
  color: string
  /** Field definitions for this resource */
  fields: ResourceField[]
  entityType?: string
  /** Whether this entity should appear in the sidebar (default: true) */
  isVisible: boolean
}

/** System resource with static display config */
export interface SystemResource extends BaseResource {
  type: 'system'
  /** API slug (e.g., 'contacts', 'tickets') */
  apiSlug: string
  /** Entity definition ID (same as id for system resources) */
  entityDefinitionId: string
  dbName: string
  display: {
    identifierField: string
    primaryDisplayField: DisplayFieldConfig | null
    secondaryDisplayField: DisplayFieldConfig | null
    avatarField: DisplayFieldConfig | null
    searchFields: string[]
    defaultSortField?: string
    defaultSortDirection?: 'asc' | 'desc'
    orgScopingStrategy: 'direct' | 'join'
    joinScoping?: JoinScopingConfig
  }
}

/** Display field with full metadata */
export interface DisplayFieldConfig {
  id: string
  /** Field display name */
  name: string
  /** Field type (CustomFieldType) */
  type: string
}

/** Custom entity resource with field-based display config */
export interface CustomResource extends BaseResource {
  type: 'custom'
  apiSlug: string
  entityDefinitionId: string
  organizationId: string
  /**
   * Data-connector ownership — set when this entity def was provisioned as an
   * `owned` target by a connector (mirrors `ResourceField.dataConnectorId` at the
   * field level). Lets cached read paths identify a connector's owned resources
   * without a fresh DB query. Undefined for user-authored / adopted defs.
   */
  dataConnectorId?: string
  display: {
    /** Primary display field with full metadata */
    primaryDisplayField: DisplayFieldConfig | null
    /** Secondary display field with full metadata */
    secondaryDisplayField: DisplayFieldConfig | null
    /** Avatar field with full metadata */
    avatarField: DisplayFieldConfig | null
    /** Default sort is always updatedAt desc for custom entities */
    defaultSortField: 'updatedAt'
    defaultSortDirection: 'desc'
    /** Custom entities always use direct org scoping via EntityInstance table */
    orgScopingStrategy: 'direct'
  }
}

/** Union type for any resource */
export type Resource = SystemResource | CustomResource

/**
 * Type guard to check if resource is a system resource
 */
export function isSystemResource(resource: Resource): resource is SystemResource {
  return resource.type === 'system'
}

/**
 * Type guard to check if resource is a custom entity resource
 */
export function isCustomResource(resource: Resource): resource is CustomResource {
  return resource.type === 'custom'
}

/**
 * Entity slugs whose visibility is governed OUTSIDE the records area, so they are
 * hidden from the entity-def Access UI (capability layer v2 phase 3):
 * - **Mail/messaging infra** (`inbox`…`sequence`) — their `ResourceAccess` rows
 *   carry mail-sharing semantics, not def restriction.
 * - **Instance-access resources** (`dataset`, `kb`, `dashboard`, `workflow`) —
 *   governed by their own L2 area + per-instance `ResourceAccess` grants (the
 *   Share card), disjoint from type-level def enforcement (plan 08 §0.6 / 11
 *   §0.6 / 12 §0.11 / 13 §0.6 / 30 §5). `article` inherits its KB's grants (no
 *   per-article grants). A def-access grid row for any of these would be a
 *   phantom control that writes rows nothing reads.
 *
 * **This set DELIBERATELY DIVERGES from the server set as of 2026-07-28.** Plan 36
 * §7.6 says to drop `signature`/`snippet` from both; that is right for the server
 * and wrong here, because the two sets do different jobs under one name:
 * - `NON_RECORD_DEF_SLUGS` (server) drives `isMailInfraDef`, whose pass-through is
 *   what made `canViewEntity('signature')` unconditionally `true`. `signature` had
 *   to leave it or plan 36 would not close the hole it exists to close.
 * - this set drives `isAccessManageable`, which HIDES a def from the type-level
 *   Access grid. Every instance-access resource is listed here for that reason —
 *   so `signature` must STAY, exactly like `dataset`/`kb`/`dashboard`/`workflow`.
 *   Removing it grows a def-access grid row that writes `ResourceAccess` rows the
 *   per-instance path never reads: the phantom control this doc comment warns
 *   about two paragraphs up.
 *
 * `snippet` is listed for symmetry only — it is a first-class table, not an
 * EntityDefinition, so it never reaches a `Resource` and the entry is inert.
 *
 * Client-safe near-mirror of the server-side `NON_RECORD_DEF_SLUGS` in
 * `permissions/capabilities/entity-access.ts` — kept in sync by hand, minus the
 * two entries above.
 */
export const NON_RECORD_ENTITY_SLUGS: ReadonlySet<string> = new Set([
  'inbox',
  // Plan 40 §3 — same mail-infrastructure reasoning as `inbox`: its
  // `ResourceAccess` rows carry mail-sharing semantics, so a def-access grid row
  // would be the phantom control this doc comment warns about. Matched on
  // `resource.entityType` by `isAccessManageable`, so the `personal-inboxes`
  // apiSlug needs no separate entry (neither does `inboxes`).
  'personal_inbox',
  'thread',
  'message',
  'sequence',
  'dataset',
  'kb',
  'article',
  'dashboard',
  'workflow',
  'signature',
  'snippet',
])

/**
 * Whether a resource's type-level access is manageable via the entity-def Access
 * UI: any CRM record def (system or custom) that is NOT a mail-infra def. Purely
 * a UI-visibility gate — the server enforces admin authorization independently.
 */
export function isAccessManageable(resource: Resource): boolean {
  return (
    !NON_RECORD_ENTITY_SLUGS.has(resource.apiSlug) &&
    !(resource.entityType != null && NON_RECORD_ENTITY_SLUGS.has(resource.entityType)) &&
    !NON_RECORD_ENTITY_SLUGS.has(resource.id)
  )
}

/**
 * Type guard to check if a string is a valid system TableId
 */
export function isSystemResourceId(id: string): id is TableId {
  return RESOURCE_TABLE_REGISTRY.some((r) => r.id === id)
}

/**
 * Type guard to check if a string is a custom resource ID (UUID format)
 * A UUID is considered custom if it's not a known system TableId
 */
export function isCustomResourceId(id: string): id is CustomResourceId {
  // Not a system resource and has UUID format (minimum CUID2 length)
  return !isSystemResourceId(id) && id.length >= 20
}
