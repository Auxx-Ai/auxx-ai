// packages/lib/src/cache/invalidation-graph.ts

import type { OrgCacheKeyName } from './org-cache-keys'
import type { UserCacheKeyName } from './user-cache-keys'

/** Org-only mapping: array of org cache keys */
type OrgOnlyMapping = readonly OrgCacheKeyName[]

/** Mixed mapping: has org and/or user cache keys */
interface MixedMapping {
  readonly user?: readonly UserCacheKeyName[]
  readonly org?: readonly OrgCacheKeyName[]
}

type InvalidationMapping = OrgOnlyMapping | MixedMapping

/**
 * Maps domain events to the cache keys they affect.
 * Single source of truth for cache dependencies.
 */
export const INVALIDATION_GRAPH: Record<string, InvalidationMapping> = {
  // ── Org-scoped events ──
  'plan.changed': ['features', 'subscription', 'overages'],
  'plan.subscribed': ['features', 'subscription', 'overages'],
  'plan.canceled': ['features', 'subscription', 'overages'],

  'org.updated': ['orgProfile'],
  'org.deleted': [], // flush all, handled specially

  'custom-field.created': ['resources', 'customFields'],
  'custom-field.updated': ['resources', 'customFields'],
  'custom-field.deleted': ['resources', 'customFields'],

  // entityDefs/entityDefSlugs are near-immutable — only invalidate on create/delete
  'entity-def.created': ['resources', 'entityDefs', 'entityDefSlugs', 'customFields'],
  'entity-def.updated': ['resources'], // slug/type don't change
  'entity-def.deleted': ['resources', 'entityDefs', 'entityDefSlugs', 'customFields'],

  'integration.connected': ['integrationProviders', 'inboxes'],
  'integration.disconnected': ['integrationProviders', 'inboxes'],

  'inbox.created': ['inboxes'],
  'inbox.updated': ['inboxes'],
  'inbox.deleted': ['inboxes'],

  // ── Mixed events (org + user keys) ──
  'member.added': {
    user: ['userMemberships'],
    org: ['members', 'memberRoleMap', 'overages'],
  },
  'member.removed': {
    user: ['userMemberships'],
    org: ['members', 'memberRoleMap', 'overages'],
  },
  'member.role.changed': {
    user: ['userMemberships'],
    org: ['members', 'memberRoleMap'],
  },

  // ── User-scoped events ──
  'user.updated': { user: ['userProfile'] },
  'user.settings.changed': { user: ['userSettings'] },
  'mail-view.changed': { user: ['userMailViews'] },
}

export type CacheEvent = keyof typeof INVALIDATION_GRAPH

export function isOrgOnlyMapping(mapping: InvalidationMapping): mapping is OrgOnlyMapping {
  return Array.isArray(mapping)
}

export function isMixedMapping(mapping: InvalidationMapping): mapping is MixedMapping {
  return !Array.isArray(mapping) && typeof mapping === 'object'
}
