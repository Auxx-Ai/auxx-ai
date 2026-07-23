// packages/lib/src/cache/org-cache-helpers.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import type { KbCatalogEntry } from '../kb/catalog/kb-catalog'
import type { CachedRecordRule } from '../record-rules/types'
import type { ResourceField } from '../resources/registry/field-types'
import type { Resource } from '../resources/registry/types'
import type {
  CachedAgent,
  CachedGroup,
  CachedInstalledApp,
  DehydratedOrgProfile,
  OrgMemberInfo,
} from './org-cache-keys'
import { getOrgCache } from './singletons'

/**
 * Get a cached resource by ID (system TableId or custom entity UUID).
 * Searches the full `resources` cache array.
 */
export async function getCachedResource(
  orgId: string,
  resourceId: string
): Promise<Resource | null> {
  const resources = await getOrgCache().get(orgId, 'resources')
  return resources.find((r) => r.id === resourceId) ?? null
}

/**
 * Find a cached resource by ID, entityType, or apiSlug.
 * Useful when the input could be any of these (e.g., 'contact', a CUID, or 'contacts').
 */
export async function findCachedResource(orgId: string, key: string): Promise<Resource | null> {
  const resources = await getOrgCache().get(orgId, 'resources')
  return resources.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
}

/**
 * Get all cached resources for an organization.
 */
export async function getCachedResources(orgId: string): Promise<Resource[]> {
  return getOrgCache().get(orgId, 'resources')
}

/**
 * Build a synchronous resolver that normalizes the definition part of a
 * RecordId (a system slug like 'contact', an apiSlug, or a custom-entity cuid)
 * to the actual `entityDefinitionId` — the value FKs to `EntityDefinition.id`
 * expect for entity-definition-backed types, and the slug for old static
 * system types (thread, user, …) that have no `EntityDefinition` row.
 *
 * Reads the `resources` cache once; resolve any number of RecordIds against
 * the returned closure in memory. Unknown keys pass through unchanged.
 */
export async function getEntityDefIdResolver(orgId: string): Promise<(slugOrId: string) => string> {
  const resources = await getCachedResources(orgId)
  const defIdByKey = new Map<string, string>()
  for (const r of resources) {
    defIdByKey.set(r.id, r.entityDefinitionId)
    if (r.entityType) defIdByKey.set(r.entityType, r.entityDefinitionId)
    defIdByKey.set(r.apiSlug, r.entityDefinitionId)
  }
  return (slugOrId) => defIdByKey.get(slugOrId) ?? slugOrId
}

/**
 * Get cached fields for a resource by ID.
 */
export async function getCachedResourceFields(
  orgId: string,
  resourceId: string
): Promise<ResourceField[]> {
  const resource = await getCachedResource(orgId, resourceId)
  return resource?.fields ?? []
}

/**
 * Get cached custom fields for an entity definition.
 */
export async function getCachedCustomFields(
  orgId: string,
  entityDefId: string
): Promise<CustomFieldEntity[]> {
  const customFields = await getOrgCache().get(orgId, 'customFields')
  return customFields[entityDefId] ?? []
}

/**
 * Get all custom fields for an entity definition as a Map keyed by field ID.
 * Single cache read — ideal for batch operations that need multiple fields from the same entity.
 */
export async function getCachedFieldMap(
  orgId: string,
  entityDefId: string
): Promise<Map<string, CustomFieldEntity>> {
  const fields = await getCachedCustomFields(orgId, entityDefId)
  return new Map(fields.map((f) => [f.id, f]))
}

/**
 * Get all cached custom fields across all entity definitions.
 */
export async function getAllCachedCustomFields(orgId: string): Promise<CustomFieldEntity[]> {
  const customFields = await getOrgCache().get(orgId, 'customFields')
  return Object.values(customFields).flat()
}

/**
 * Get all record rules for an organization (enabled + disabled; dispatch filters).
 */
export async function getCachedRecordRules(orgId: string): Promise<CachedRecordRule[]> {
  return getOrgCache().get(orgId, 'recordRules')
}

/**
 * Resolve an entityType to its entityDefinitionId using the cache.
 * Returns undefined if not found.
 */
export async function getCachedEntityDefId(
  orgId: string,
  entityType: string
): Promise<string | undefined> {
  const entityDefs = await getOrgCache().get(orgId, 'entityDefs')
  return entityDefs[entityType]
}

/**
 * Resolve an entityType to its entityDefinitionId using the cache.
 * Throws if not found.
 */
export async function requireCachedEntityDefId(orgId: string, entityType: string): Promise<string> {
  const id = await getCachedEntityDefId(orgId, entityType)
  if (!id) {
    throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
  }
  return id
}

// ── AI default model cache helpers ──

/** Get a single cached default model by type. Returns null if not configured. */
export async function getCachedDefaultModel(
  orgId: string,
  modelType: string
): Promise<{ provider: string; model: string } | null> {
  const defaults = await getOrgCache().get(orgId, 'aiDefaultModels')
  const entry = defaults[modelType]
  return entry ? { provider: entry.provider, model: entry.model } : null
}

// ── Member cache helpers ──

/**
 * Get cached org members, optionally filtered by status and roles.
 */
export async function getCachedMembers(
  orgId: string,
  options?: { status?: string; roles?: string[] }
): Promise<OrgMemberInfo[]> {
  const members = await getOrgCache().get(orgId, 'members')
  let filtered = members

  if (options?.status) {
    filtered = filtered.filter((m) => m.status === options.status)
  }
  if (options?.roles?.length) {
    filtered = filtered.filter((m) => options.roles!.includes(m.role))
  }

  return filtered
}

/**
 * Get cached org members by user IDs.
 */
export async function getCachedMembersByUserIds(
  orgId: string,
  userIds: string[]
): Promise<OrgMemberInfo[]> {
  const members = await getOrgCache().get(orgId, 'members')
  const idSet = new Set(userIds)
  return members.filter((m) => idSet.has(m.userId))
}

/**
 * Check whether a user is a member of an organization (cached).
 */
export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const members = await getOrgCache().get(orgId, 'members')
  return members.some((m) => m.userId === userId)
}

/**
 * Whether the org has ANY PermissionGrant rows (cached). Composition reads this
 * to skip the grant query for orgs that never customized (§6.1).
 */
export async function getCachedHasPermissionGrants(orgId: string): Promise<boolean> {
  return getOrgCache().get(orgId, 'hasPermissionGrants')
}

// ── Group cache helpers ──

/**
 * Get all cached groups for an organization.
 */
export async function getCachedGroups(orgId: string): Promise<CachedGroup[]> {
  return getOrgCache().get(orgId, 'groups')
}

/**
 * Get the group instance IDs a user belongs to (memberType='user' edges), cached.
 * Includes archived groups — same semantics as the raw EntityGroupMember queries
 * this replaces.
 */
export async function getCachedUserGroupIds(orgId: string, userId: string): Promise<string[]> {
  const groupMembers = await getOrgCache().get(orgId, 'groupMembers')
  return groupMembers[userId] ?? []
}

// ── KB catalog helpers ──

/**
 * Get the org's KB catalog — published, AI-enabled articles per knowledge
 * base, in tree order. Rendered into agent prompts via `renderKbCatalog`.
 */
export async function getCachedKbCatalog(orgId: string): Promise<KbCatalogEntry[]> {
  return getOrgCache().get(orgId, 'kbCatalog')
}

// ── Agent cache helpers ──

/**
 * Get all cached agents for an organization (active only by default — filters archivedAt).
 */
export async function getCachedAgents(orgId: string): Promise<CachedAgent[]> {
  const agents = await getOrgCache().get(orgId, 'agents')
  return agents.filter((a) => !a.archivedAt)
}

/**
 * Get every cached agent for an organization, including archived rows.
 * Use when admin tooling needs to surface archived agents.
 */
export async function getAllCachedAgents(orgId: string): Promise<CachedAgent[]> {
  return getOrgCache().get(orgId, 'agents')
}

/**
 * Find a single cached agent by id within an org, including archived rows.
 * Returns null when the agent does not belong to the org or does not exist.
 */
export async function getCachedAgentById(
  orgId: string,
  agentId: string
): Promise<CachedAgent | null> {
  const agents = await getOrgCache().get(orgId, 'agents')
  return agents.find((a) => a.id === agentId) ?? null
}

/**
 * Get cached agents matching the given backing-user IDs.
 * Includes archived agents so historical attributions resolve correctly.
 */
export async function getCachedAgentsByUserIds(
  orgId: string,
  userIds: string[]
): Promise<CachedAgent[]> {
  const agents = await getOrgCache().get(orgId, 'agents')
  const idSet = new Set(userIds)
  return agents.filter((a) => idSet.has(a.userId))
}

/**
 * Get cached agents by `Agent.id`. Includes archived rows so historical
 * actor references (e.g. `agent:<id>` stored in a comment) still resolve.
 */
export async function getCachedAgentsByIds(
  orgId: string,
  agentIds: string[]
): Promise<CachedAgent[]> {
  const agents = await getOrgCache().get(orgId, 'agents')
  const idSet = new Set(agentIds)
  return agents.filter((a) => idSet.has(a.id))
}

/**
 * Check whether the given user id is the synthetic user of an agent in this org.
 */
export async function isAgentUser(orgId: string, userId: string): Promise<boolean> {
  const agents = await getOrgCache().get(orgId, 'agents')
  return agents.some((a) => a.userId === userId)
}

// ── Installed-apps cache helpers ──

/**
 * Get the org's installed apps (cached). Includes the synthetic built-in `auxx`
 * row plus every third-party installation with its catalog projections.
 */
export async function getCachedInstalledApps(orgId: string): Promise<CachedInstalledApp[]> {
  return getOrgCache().get(orgId, 'installedApps')
}

/**
 * Resolve an `appInstallationId` to its app slug + title via the installed-apps
 * cache. Returns null when no live installation matches (uninstalled / unknown).
 */
export async function getCachedAppByInstallationId(
  orgId: string,
  installationId: string
): Promise<{ slug: string; title: string } | null> {
  const apps = await getCachedInstalledApps(orgId)
  const match = apps.find((a) => a.installationId === installationId)
  return match ? { slug: match.app.slug, title: match.app.title } : null
}

// ── Channel cache helpers ──

/**
 * Returns true when the org has at least one enabled chat integration with an
 * active widget. Derived from the existing `channels` cache, so no new key.
 *
 * Used to gate Phase 4c chat-duty UI (nav-user toggle, handoff banner copy,
 * assignee-picker filter) — features only surface once chat is set up.
 */
export async function getCachedOrgHasActiveChat(orgId: string): Promise<boolean> {
  const channels = await getOrgCache().get(orgId, 'channels')
  return channels.some((c) => c.provider === 'chat' && c.enabled && c.chatWidget?.isActive === true)
}

// ── Org profile cache helper ──

/**
 * Get the dehydrated org profile (name, website, domains, handle, …) from the
 * org cache. Returns null when the profile has not been hydrated for this org
 * (rare — onboarding hydrates it).
 */
export async function getCachedOrgProfile(orgId: string): Promise<DehydratedOrgProfile | null> {
  const profile = await getOrgCache().get(orgId, 'orgProfile')
  return profile ?? null
}
