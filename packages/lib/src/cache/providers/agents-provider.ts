// packages/lib/src/cache/providers/agents-provider.ts

import { type AgentConfig, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { MediaAssetService } from '../../files'
import { createScopedLogger } from '../../logger'
import type { CachedAgent, CachedAgentTrigger } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('agents-provider')

/**
 * Computes all agents for an organization (including archived; consumers filter).
 *
 * Under Option D draft agents have no backing User row — the join is a
 * LEFT JOIN and the presentation fields fall back to `Agent.config`:
 *
 *   - `name`:           `User.name ?? Agent.config.name ?? null`
 *   - `avatarAssetId`:  `User.avatarAssetId ?? Agent.config.avatarAssetId ?? null`
 *     (then resolved to a URL via the standard MediaAsset pipeline).
 *
 * Non-User-owned config keys (`color`, `iconId`) live only on `Agent.config`.
 * See plans/kopilot/agents/dm/option-d-defer-user-plan.md.
 *
 * Trigger rows are loaded in a second query and attached as `agent.triggers`;
 * the DM-derived fields (`dmEnabled`/`dmInstructions`/`dmTriggerId`) are
 * computed from that list. Hot-path consumers (worker dispatchers, jobs)
 * read triggers off the cached agent — see
 * plans/kopilot/agents/cache/plan.md.
 */
export const agentsProvider: CacheProvider<CachedAgent[]> = {
  async compute(orgId, db) {
    const [agents, triggers] = await Promise.all([
      db
        .select({
          id: schema.Agent.id,
          userId: schema.Agent.userId,
          createdById: schema.Agent.createdById,
          slug: schema.Agent.slug,
          description: schema.Agent.description,
          prompt: schema.Agent.prompt,
          toolsets: schema.Agent.toolsets,
          knowledge: schema.Agent.knowledge,
          modelId: schema.Agent.modelId,
          mentionable: schema.Agent.mentionable,
          setupCompletedAt: schema.Agent.setupCompletedAt,
          archivedAt: schema.Agent.archivedAt,
          config: schema.Agent.config,
          createdAt: schema.Agent.createdAt,
          updatedAt: schema.Agent.updatedAt,
          userName: schema.User.name,
          userAvatarAssetId: schema.User.avatarAssetId,
        })
        .from(schema.Agent)
        .leftJoin(schema.User, eq(schema.User.id, schema.Agent.userId))
        .where(eq(schema.Agent.organizationId, orgId)),
      db
        .select({
          id: schema.AgentTrigger.id,
          agentId: schema.AgentTrigger.agentId,
          kind: schema.AgentTrigger.kind,
          enabled: schema.AgentTrigger.enabled,
          triggerType: schema.AgentTrigger.triggerType,
          entityDefinitionId: schema.AgentTrigger.entityDefinitionId,
          eventType: schema.AgentTrigger.eventType,
          triggerAppId: schema.AgentTrigger.triggerAppId,
          triggerAppTriggerId: schema.AgentTrigger.triggerAppTriggerId,
          triggerInstallationId: schema.AgentTrigger.triggerInstallationId,
          triggerConnectionId: schema.AgentTrigger.triggerConnectionId,
          config: schema.AgentTrigger.config,
          instructions: schema.AgentTrigger.instructions,
        })
        .from(schema.AgentTrigger)
        .where(eq(schema.AgentTrigger.organizationId, orgId)),
    ])

    const triggersByAgent = new Map<string, CachedAgentTrigger[]>()
    for (const t of triggers) {
      const list = triggersByAgent.get(t.agentId) ?? []
      list.push({
        id: t.id,
        kind: t.kind as CachedAgentTrigger['kind'],
        enabled: t.enabled,
        triggerType: t.triggerType as CachedAgentTrigger['triggerType'],
        entityDefinitionId: t.entityDefinitionId,
        eventType: t.eventType,
        triggerAppId: t.triggerAppId,
        triggerAppTriggerId: t.triggerAppTriggerId,
        triggerInstallationId: t.triggerInstallationId,
        triggerConnectionId: t.triggerConnectionId,
        config: (t.config ?? null) as Record<string, unknown> | null,
        instructions: (t.instructions ?? null) as Record<string, unknown> | null,
      })
      triggersByAgent.set(t.agentId, list)
    }

    return Promise.all(
      agents.map(async (row): Promise<CachedAgent> => {
        const config = (row.config ?? {}) as AgentConfig
        const name = row.userName ?? config.name ?? null
        const avatarAssetId = row.userAvatarAssetId ?? config.avatarAssetId ?? null

        let avatarUrl: string | null = null
        if (avatarAssetId) {
          // MediaAssetService scopes uploads under the owning user; for User-
          // owned assets we use `Agent.userId`. For config-only assets (draft)
          // we currently have no such writer (the v1 builder pool has assetId
          // null), so this branch is effectively unreachable until curated
          // illustrations land. Fall back to `row.userId` when set; otherwise
          // pass the orgId as the owner (the asset is org-scoped).
          const ownerId = row.userId ?? orgId
          const mediaAssetService = new MediaAssetService(orgId, ownerId, db)
          try {
            avatarUrl = await mediaAssetService.getDownloadUrl(avatarAssetId)
          } catch (error) {
            logger.warn(`Failed to fetch avatar URL for agent ${row.id}`, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const agentTriggers = triggersByAgent.get(row.id) ?? []
        const dm = agentTriggers.find((t) => t.kind === 'dm')

        return {
          id: row.id,
          userId: row.userId,
          createdById: row.createdById,
          name,
          slug: row.slug,
          description: row.description ?? null,
          avatarUrl,
          prompt: (row.prompt ?? {}) as Record<string, unknown>,
          toolsets: row.toolsets ?? [],
          knowledge: row.knowledge ?? [],
          modelId: row.modelId ?? null,
          mentionable: row.mentionable,
          setupCompletedAt: row.setupCompletedAt ? row.setupCompletedAt.toISOString() : null,
          archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
          triggers: agentTriggers,
          dmEnabled: dm?.enabled ?? false,
          dmInstructions: dm?.instructions ?? null,
          dmTriggerId: dm?.id ?? null,
          config: row.config ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      })
    )
  },
}
