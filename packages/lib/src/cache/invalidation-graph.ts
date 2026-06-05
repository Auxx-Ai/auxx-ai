// packages/lib/src/cache/invalidation-graph.ts

import type { BuildUserCacheKeyName } from './build-user-cache-keys'
import type { OrgCacheKeyName } from './org-cache-keys'
import type { UserCacheKeyName } from './user-cache-keys'

/** Org-only mapping: array of org cache keys */
type OrgOnlyMapping = readonly OrgCacheKeyName[]

/** Mixed mapping: has org and/or user and/or build cache keys */
interface MixedMapping {
  readonly user?: readonly UserCacheKeyName[]
  readonly org?: readonly OrgCacheKeyName[]
  readonly build?: readonly BuildUserCacheKeyName[]
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

  // entityDefs/entityDefSlugs — invalidate slugs on create/delete/update (archive changes visibility)
  'entity-def.created': ['resources', 'entityDefs', 'entityDefSlugs', 'customFields', 'overages'],
  'entity-def.updated': ['resources', 'entityDefs', 'entityDefSlugs'],
  'entity-def.deleted': ['resources', 'entityDefs', 'entityDefSlugs', 'customFields', 'overages'],

  'channel.connected': ['channelProviders', 'inboxes', 'channels', 'overages'],
  'channel.disconnected': ['channelProviders', 'inboxes', 'channels', 'overages'],
  'channel.toggled': ['channels'],
  'channel.settings_updated': ['channels'],
  'channel.inbox-link.changed': ['channels', 'inboxes'],

  'group.created': ['groups'],
  'group.updated': ['groups'],
  'group.deleted': ['groups'],
  'group.members.changed': ['groups'],

  'agent.created': ['agents'],
  'agent.updated': ['agents'],
  'agent.archived': ['agents'],
  'agent.deleted': ['agents'],

  // Only PUBLISH/REVERT busts the agents projection — drafts never affect live
  // runs (the projection joins `activeVersionId`). See phase-4-wiring.md §4.4.
  'procedure.updated': ['agents'],

  'inbox.created': ['inboxes'],
  'inbox.updated': ['inboxes'],
  'inbox.deleted': ['inboxes'],

  // Workflow lifecycle events
  'workflow.published': ['workflowApps'],
  'workflow.enabled': ['workflowApps'],
  'workflow.updated': ['workflowApps'],
  'workflow.created': ['workflowApps', 'overages'],
  'workflow.deleted': ['workflowApps', 'overages'],

  // App lifecycle events
  'app.installed': ['installedApps'],
  'app.uninstalled': ['installedApps'],
  'app.deployment.changed': ['installedApps'],
  'app.connection-def.changed': ['installedApps'],
  // App connection (credential) lifecycle — bust the catalog cache because
  // `installedAppsProvider` denormalizes org-scope presence (decision B2 / G2).
  'app-connection.created': ['installedApps'],
  'app-connection.deleted': ['installedApps'],
  'app-connection.refreshed': ['installedApps'],

  // ── AI provider events ──
  'ai-provider.configured': ['aiProviderConfigs', 'aiCredentials'],
  'ai-provider.deleted': ['aiProviderConfigs', 'aiCredentials'],
  'ai-provider.credentials-changed': ['aiCredentials'],
  'ai-provider.type-switched': ['aiProviderConfigs', 'aiCredentials'],
  'ai-model.configured': ['aiProviderConfigs', 'aiCredentials'],
  'ai-model.deleted': ['aiProviderConfigs', 'aiCredentials'],
  'ai-default-model.changed': ['aiDefaultModels'],

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
  // Chat-duty toggle (Phase 4c) — only the cached `members` row changes
  // (roles untouched), so we keep the invalidation tight.
  'member.chat-duty.changed': ['members'],

  // ── Settings events ──
  'org.settings.changed': { org: ['orgSettings'], user: ['userSettings'] },

  // ── User-scoped events ──
  'user.updated': { user: ['userProfile'] },
  'user.settings.changed': { user: ['userSettings'] },
  'mail-view.changed': { user: ['userMailViews'], org: ['overages'] },

  // ── Table view events ──
  'table-view.created': { user: ['userTableViews'], org: ['overages'] },
  'table-view.updated': { user: ['userTableViews'] },
  'table-view.deleted': { user: ['userTableViews'], org: ['overages'] },
  'table-view.default-changed': { user: ['userTableViews'] },

  // ── Favorite events ──
  'favorite.changed': { user: ['userFavorites'] },
  'favorite-folder.changed': { user: ['userFavorites'] },

  // ── KB & article events (affects overages for knowledgeBases / kbPublishedArticles) ──
  'kb.created': ['overages'],
  'kb.deleted': ['overages'],
  'article.published': ['overages'],
  'article.unpublished': ['overages'],
  'article.deleted': ['overages'],

  // ── Dataset events (affects overages for datasetsLimit) ──
  'dataset.created': ['overages'],
  'dataset.deleted': ['overages'],

  // ── Build portal events ──
  'build.developer-account.created': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.updated': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.deleted': { build: ['buildDeveloperAccounts', 'buildApps'] },

  'build.developer-account.member-added': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.member-removed': { build: ['buildDeveloperAccounts'] },

  'build.app.created': { build: ['buildApps'] },
  'build.app.updated': { build: ['buildApps'] },
  'build.app.deleted': { build: ['buildApps'] },

  'build.organization.changed': { build: ['buildOrganizations'] },
}

export type CacheEvent = keyof typeof INVALIDATION_GRAPH

export function isOrgOnlyMapping(mapping: InvalidationMapping): mapping is OrgOnlyMapping {
  return Array.isArray(mapping)
}

export function isMixedMapping(mapping: InvalidationMapping): mapping is MixedMapping {
  return !Array.isArray(mapping) && typeof mapping === 'object'
}
