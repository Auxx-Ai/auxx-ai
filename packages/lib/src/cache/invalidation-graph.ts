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

  'channel.connected': ['channelProviders', 'inboxes'],
  'channel.disconnected': ['channelProviders', 'inboxes'],

  'group.created': ['groups'],
  'group.updated': ['groups'],
  'group.deleted': ['groups'],
  'group.members.changed': ['groups'],

  'inbox.created': ['inboxes'],
  'inbox.updated': ['inboxes'],
  'inbox.deleted': ['inboxes'],

  // Workflow lifecycle events
  'workflow.published': ['workflowApps'],
  'workflow.enabled': ['workflowApps'],
  'workflow.created': ['workflowApps'],
  'workflow.deleted': ['workflowApps'],

  // App lifecycle events
  'app.installed': ['installedApps'],
  'app.uninstalled': ['installedApps'],
  'app.deployment.changed': ['installedApps'],
  'app.connection-def.changed': ['installedApps'],

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

  // ── Settings events ──
  'org.settings.changed': { org: ['orgSettings'], user: ['userSettings'] },

  // ── User-scoped events ──
  'user.updated': { user: ['userProfile'] },
  'user.settings.changed': { user: ['userSettings'] },
  'mail-view.changed': { user: ['userMailViews'] },

  // ── Table view events ──
  'table-view.created': { user: ['userTableViews'] },
  'table-view.updated': { user: ['userTableViews'] },
  'table-view.deleted': { user: ['userTableViews'] },
  'table-view.default-changed': { user: ['userTableViews'] },
}

export type CacheEvent = keyof typeof INVALIDATION_GRAPH

export function isOrgOnlyMapping(mapping: InvalidationMapping): mapping is OrgOnlyMapping {
  return Array.isArray(mapping)
}

export function isMixedMapping(mapping: InvalidationMapping): mapping is MixedMapping {
  return !Array.isArray(mapping) && typeof mapping === 'object'
}
