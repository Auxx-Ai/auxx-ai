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

  // System rules resolve field ids from the customFields projection — any customFields
  // change can change which system rules resolve for an org, so recompute the union.
  'custom-field.created': ['resources', 'customFields', 'recordRules'],
  'custom-field.updated': ['resources', 'customFields', 'recordRules'],
  // A field delete cascades its RecordRules away (FK) — bust the rules cache too.
  'custom-field.deleted': ['resources', 'customFields', 'recordRules'],

  // entityDefs/entityDefSlugs — invalidate slugs on create/delete/update (archive changes visibility).
  // recordRules rides along: system rules resolve their target def BY SLUG through the
  // entityDefSlugs projection, so a slug rename/create/delete changes which rules
  // resolve — same reason custom-field.* busts it below.
  'entity-def.created': [
    'resources',
    'entityDefs',
    'entityDefSlugs',
    'customFields',
    'overages',
    'recordRules',
  ],
  'entity-def.updated': ['resources', 'entityDefs', 'entityDefSlugs', 'recordRules'],
  'entity-def.deleted': [
    'resources',
    'entityDefs',
    'entityDefSlugs',
    'customFields',
    'overages',
    'recordRules',
  ],

  'channel.connected': ['channelProviders', 'inboxes', 'channels', 'overages'],
  'channel.disconnected': ['channelProviders', 'inboxes', 'channels', 'overages'],
  'channel.toggled': ['channels'],
  'channel.settings_updated': ['channels'],
  'channel.inbox-link.changed': ['channels', 'inboxes'],

  'group.created': ['groups'],
  'group.updated': ['groups'],
  // Deleting a group cascade-deletes its EntityGroupMember rows — group grants
  // stop resolving for its members, so both visibility caches recompute.
  'group.deleted': {
    org: ['groups', 'groupMembers', 'mailGrantIndex'],
    user: ['userMailVisibility', 'userCapabilities'],
  },
  // Emit sites pass the affected `userIds` (or broadcast for non-user member
  // edits) so the per-user visibility contexts recompute. `groupMembers` is the
  // key behind getCachedUserGroupIds, so group grants change the composed
  // capability set — recompute userCapabilities too.
  'group.members.changed': {
    org: ['groups', 'groupMembers', 'mailGrantIndex'],
    user: ['userMailVisibility', 'userCapabilities'],
  },

  'agent.created': ['agents'],
  'agent.updated': ['agents'],
  'agent.archived': ['agents'],
  'agent.deleted': ['agents'],

  // Only PUBLISH/REVERT busts the agents projection — drafts never affect live
  // runs (the projection joins `activeVersionId`). See phase-4-wiring.md §4.4.
  'procedure.updated': ['agents'],

  // Inbox floors (defaultLens) feed every member's visibility context — emit
  // sites broadcast user keys (org-wide fan-out).
  'inbox.created': { org: ['inboxes'], user: ['userMailVisibility'] },
  'inbox.updated': { org: ['inboxes'], user: ['userMailVisibility'] },
  'inbox.deleted': { org: ['inboxes'], user: ['userMailVisibility'] },

  // Record-rule lifecycle events
  'record-rule.changed': ['recordRules'],

  // Workflow lifecycle events
  'workflow.published': ['workflowApps'],
  'workflow.enabled': ['workflowApps'],
  'workflow.updated': ['workflowApps'],
  'workflow.created': ['workflowApps', 'overages'],
  'workflow.deleted': ['workflowApps', 'overages'],

  // App lifecycle events
  'app.installed': ['installedApps'],
  'app.uninstalled': ['installedApps'],
  // Rolling installations onto a new deployment (auto-update) reprovisions
  // installation-scoped app fields for every affected org — bust customFields
  // too, or a freshly provisioned field is unresolved by the @app: rail until
  // its TTL (plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md).
  'app.deployment.changed': ['installedApps', 'customFields'],
  'app.connection-def.changed': ['installedApps'],
  // App connection (credential) lifecycle — bust the catalog cache because
  // `installedAppsProvider` denormalizes org-scope presence (decision B2 / G2).
  'app-connection.created': ['installedApps'],
  'app-connection.deleted': ['installedApps'],
  'app-connection.refreshed': ['installedApps'],

  // MCP server lifecycle events
  'mcp.server.changed': ['mcpServers'], // create/update/delete of McpServer or its ConnectionDefinition
  'mcp.tools.synced': ['mcpServers'], // sync + trust updates
  'mcp.connection.changed': ['mcpServers'], // credential created/deleted/refreshed

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
    user: ['userMemberships', 'userMailVisibility', 'userCapabilities'],
    org: ['members', 'memberRoleMap', 'overages', 'mailGrantIndex'],
  },
  'member.removed': {
    user: ['userMemberships', 'userMailVisibility', 'userCapabilities'],
    org: ['members', 'memberRoleMap', 'overages', 'mailGrantIndex'],
  },
  'member.role.changed': {
    user: ['userMemberships', 'userMailVisibility', 'userCapabilities'],
    org: ['members', 'memberRoleMap'],
  },
  // Seat-type change (full ⇄ worker) — the role map carries seatType, so the
  // composed capability set (and its ceiling clamp) changes.
  'member.seat-type.changed': {
    user: ['userCapabilities'],
    org: ['members', 'memberRoleMap'],
  },
  // Chat-duty toggle (Phase 4c) — only the cached `members` row changes
  // (roles untouched), so we keep the invalidation tight.
  'member.chat-duty.changed': ['members'],

  // ── Mail visibility (mail-permissions plan) ──
  // Emitted by every ResourceAccess grant/revoke/set mutation. User grants
  // target a single user; group/role/team grants fan out org-wide
  // (`broadcastUserKeys` at the emit site).
  'resource-access.changed': { user: ['userMailVisibility'], org: ['mailGrantIndex'] },
  // Type-level (entityInstanceId IS NULL) grant changes feed `defAccess` in the
  // capability blob (per-user) AND the org-wide `restrictedEntityDefIds` set
  // (read-path enforcement §0). A narrow event so the noisy instance-level
  // `resource-access.changed` is NOT piggybacked (§9.0).
  'resource-access.type.changed': {
    user: ['userCapabilities'],
    org: ['restrictedEntityDefIds'],
  },
  // Instance-level grant changes on an instance-access resource (datasets etc.)
  // feed `instanceAccess` in the capability blob (per-user) AND the org-wide
  // `restrictedInstanceIds` set (§1.5). Emitted ONLY when the target's def id ∈
  // INSTANCE_ACCESS_RESOURCES, so generic mail-share instance traffic (which
  // fires the noisy `resource-access.changed`) never churns these caches.
  'resource-access.instance.changed': {
    user: ['userCapabilities'],
    org: ['restrictedInstanceIds'],
  },

  // ── Capability grants (permissions plan §5.3) ──
  // Emitted by every PermissionGrant create/update/delete. User grants target a
  // single user; role/group grants fan out org-wide (`broadcastUserKeys` at the
  // emit site, same pattern as `resource-access.changed`).
  'permission-grant.changed': { user: ['userCapabilities'], org: ['hasPermissionGrants'] },

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

  // ── KB & article events (overages for knowledgeBases / kbPublishedArticles;
  // kbCatalog is the agent-prompt ToC of published articles) ──
  'kb.created': ['overages', 'kbCatalog'],
  'kb.deleted': ['overages', 'kbCatalog'],
  'kb.updated': ['kbCatalog'], // name / visibility changes
  'article.published': ['overages', 'kbCatalog'],
  'article.unpublished': ['overages', 'kbCatalog'],
  'article.deleted': ['overages', 'kbCatalog'],
  // Emitted by enqueueKBSync — the choke point every published-content
  // mutation already flows through (archive, aiEnabled toggle, move/rename
  // metadata sync, source-sink writes).
  'article.changed': ['kbCatalog'],

  // ── Dataset events (affects overages for datasetsLimit) ──
  'dataset.created': ['overages'],
  'dataset.deleted': ['overages'],

  // ── Build portal events ──
  'build.developer-account.created': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.updated': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.deleted': { build: ['buildDeveloperAccounts', 'buildApps'] },

  'build.developer-account.member-added': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.member-removed': { build: ['buildDeveloperAccounts'] },
  'build.developer-account.member-role-changed': { build: ['buildDeveloperAccounts'] },

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
