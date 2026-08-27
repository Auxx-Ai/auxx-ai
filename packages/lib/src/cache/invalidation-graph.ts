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

  // `recordRules` caches DB rules ONLY — system rules resolve per read now, so a
  // customFields change no longer changes what this key holds. `created`/`updated`
  // are kept as harmless redundancy; `deleted` is REQUIRED (below).
  'custom-field.created': ['resources', 'customFields', 'recordRules'],
  'custom-field.updated': ['resources', 'customFields', 'recordRules'],
  // A field delete cascades its RecordRules away (FK) — bust the rules cache too.
  'custom-field.deleted': ['resources', 'customFields', 'recordRules'],

  // entityDefs/entityDefSlugs — invalidate slugs on create/delete/update (archive changes visibility).
  // recordRules rides along: `deleted` is REQUIRED (a def delete cascades its RecordRules
  // away by FK). `created`/`updated` are harmless redundancy — they mattered when the
  // system-rule union was cached under this key and resolved defs BY SLUG; it is now
  // resolved per read (`cache/org-system-rules.ts`), so a slug change needs no bust here.
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
  // requiresReauth/lastAuthError live on the Credential but are served to the UI
  // through the cached channel list — without this, an auth failure stays
  // invisible until the day-long TTL expires or an unrelated channel event fires.
  'channel.auth-state.changed': ['channels'],
  // Emitted by `invalidateChannelsIfStale` when a live DB read observes channel
  // state (enabled/requiresReauth) the cached snapshot disagrees with.
  'channel.stale-state.detected': ['channels'],

  'group.created': ['groups'],
  'group.updated': ['groups'],
  // Deleting a group cascade-deletes its EntityGroupMember rows — group grants
  // stop resolving for its members, so both visibility caches recompute.
  'group.deleted': {
    org: ['groups', 'groupMembers', 'mailGrantIndex'],
    user: ['userInstanceGrants', 'userCapabilities'],
  },
  // Emit sites pass the affected `userIds` (or broadcast for non-user member
  // edits) so the per-user visibility contexts recompute. `groupMembers` is the
  // key behind getCachedUserGroupIds, so group grants change the composed
  // capability set — recompute userCapabilities too.
  'group.members.changed': {
    org: ['groups', 'groupMembers', 'mailGrantIndex'],
    user: ['userInstanceGrants', 'userCapabilities'],
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
  'inbox.created': { org: ['inboxes'], user: ['userInstanceGrants'] },
  'inbox.updated': { org: ['inboxes'], user: ['userInstanceGrants'] },
  // `MailFilter.inboxId` cascades on inbox delete (invariant 18) — the rows are
  // gone from the DB, so the cached array must go with them or the gate keeps
  // evaluating filters whose containment boundary no longer exists.
  //
  // NOT added to `channel.*`: disconnecting a channel is a SOFT delete of the
  // `Integration` row and leaves the inbox (and therefore its filters) intact.
  // Filters key on the inbox, never on the channel.
  'inbox.deleted': { org: ['inboxes', 'mailFilters'], user: ['userInstanceGrants'] },

  // Record-rule lifecycle events
  'record-rule.changed': ['recordRules'],

  // Mail-filter lifecycle events (create/update/delete/reorder/enable — every
  // write in `mail-filters/mutations.ts` emits this).
  'mail-filter.changed': ['mailFilters'],

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
    user: ['userMemberships', 'userInstanceGrants', 'userCapabilities'],
    org: ['members', 'memberRoleMap', 'overages', 'mailGrantIndex'],
  },
  'member.removed': {
    user: ['userMemberships', 'userInstanceGrants', 'userCapabilities'],
    org: ['members', 'memberRoleMap', 'overages', 'mailGrantIndex'],
  },
  'member.role.changed': {
    user: ['userMemberships', 'userInstanceGrants', 'userCapabilities'],
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
  'resource-access.changed': { user: ['userInstanceGrants'], org: ['mailGrantIndex'] },
  // Type-level (entityInstanceId IS NULL) grant changes feed `defAccess` in the
  // capability blob (per-user) AND the org-wide `restrictedEntityDefIds` set
  // (read-path enforcement §0). A narrow event so the noisy instance-level
  // `resource-access.changed` is NOT piggybacked (§9.0).
  'resource-access.type.changed': {
    user: ['userCapabilities'],
    org: ['restrictedEntityDefIds'],
  },
  // Instance-level grant changes feed the capability blob, so this event is
  // DEF-AGNOSTIC (v3/03 §9): every instance grant/revoke/set fires it, whatever
  // keyspace `entityDefinitionId` is in. It used to be gated on
  // `isInstanceAccessKey`, which can never be true for a record-def CUID — so a
  // record share invalidated only the mail keys and left the capability blob
  // (where §4's `grantedDefIds` front door lives) stale for the full ONE_DAY TTL
  // on the very first share.
  'resource-access.instance.changed': {
    user: ['userCapabilities'],
  },
  // The org-wide `governingInstanceIds` set (§1.5) stays keyspace-gated, and is
  // therefore its own event: the provider selects
  // `entityDefinitionId IN INSTANCE_ACCESS_KEYS` in SQL and re-filters through
  // `isGoverningInstanceRow` in JS, so a row on any other def provably cannot
  // enter the set. Recomputing it for record/thread instance traffic would be an
  // org-wide query with a guaranteed-unchanged answer. Emitted only when the
  // target's def id ∈ INSTANCE_ACCESS_RESOURCES, and BEFORE the def-agnostic
  // event above so the org key is fresh when clients refetch capabilities.
  'resource-access.governing-instance.changed': {
    org: ['governingInstanceIds'],
  },

  // ── Capability grants (permissions plan §5.3) ──
  // Emitted by every PermissionGrant create/update/delete. User grants target a
  // single user; group grants fan out org-wide (`broadcastUserKeys` at the emit
  // site, same pattern as `resource-access.changed`). A `profile` grantee uses the
  // doc-19 §8.3 audience instead (bound holders + the (role, seatType) sweep for
  // system profiles), because its levels are the composition BASE.
  //
  // `userInstanceGrants` rides along since plan 40 §4.5: `composeUserInstanceGrants`
  // now READS the capability blob (the `Area.inboxes` fallback §4.2 + `isMailAdmin`
  // §4.4), so a grant that lowers `inboxes` must reshape the mail blob in the same
  // breath. Without this edge the downgrade would land in `userCapabilities` while
  // the member kept reading mail off a stale mail blob for the full ONE_DAY TTL —
  // the one stale-blob direction in this slice that fails OPEN.
  'permission-grant.changed': {
    user: ['userCapabilities', 'userInstanceGrants'],
    org: ['hasPermissionGrants'],
  },

  // ── Permission profiles (doc 19 §8.3) ──
  // Emitted by every PermissionProfile create/update/delete. Busts the org's
  // `profiles` projection (the composer resolves profileId → base/ceiling from it)
  // and recomputes the affected members' capability blobs. The emit site resolves
  // the audience — crucially including NULL-BOUND holders for a system profile,
  // who are the majority and are invisible to an index sweep.
  //
  // `userInstanceGrants` for the same reason as `permission-grant.changed` above
  // (plan 40 §4.5) — a profile IS the composition base, so editing one moves the
  // `Area.inboxes` level for every holder at once.
  'permission-profile.changed': {
    user: ['userCapabilities', 'userInstanceGrants'],
    org: ['profiles'],
  },

  // ── Settings events ──
  'org.settings.changed': { org: ['orgSettings'], user: ['userSettings'] },

  // ── User-scoped events ──
  // `members` is here because that org blob projects mutable user columns —
  // name, email, image, preferredTimezone — so a profile edit leaves it stale
  // until its TTL otherwise. Caveat: this invalidates only the org in
  // `context.orgId` (invalidate.ts requires one), so for a user who belongs to
  // several orgs the other orgs' member blobs still lag to TTL.
  'user.updated': { user: ['userProfile'], org: ['members'] },
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
  // kbCatalog is the agent-prompt ToC of published articles; `knowledgeBases` is
  // the id+kind allow-list article visibility is built from — plan v3/06 §5.3,
  // and its stale-blob direction is fail-CLOSED, so these three events are what
  // bound "a KB I just made hides its own articles") ──
  'kb.created': ['overages', 'kbCatalog', 'knowledgeBases'],
  'kb.deleted': ['overages', 'kbCatalog', 'knowledgeBases'],
  'kb.updated': ['kbCatalog', 'knowledgeBases'], // name / visibility / kind changes
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
