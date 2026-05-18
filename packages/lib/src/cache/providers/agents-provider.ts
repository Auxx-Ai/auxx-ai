// packages/lib/src/cache/providers/agents-provider.ts

import { type AgentConfig, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { MediaAssetService } from '../../files'
import { createScopedLogger } from '../../logger'
import type { CachedAgent } from '../org-cache-keys'
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
 */
export const agentsProvider: CacheProvider<CachedAgent[]> = {
  async compute(orgId, db) {
    const rows = await db
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
        dmTriggerId: schema.AgentTrigger.id,
        dmEnabled: schema.AgentTrigger.enabled,
        dmInstructions: schema.AgentTrigger.instructions,
      })
      .from(schema.Agent)
      .leftJoin(schema.User, eq(schema.User.id, schema.Agent.userId))
      .leftJoin(
        schema.AgentTrigger,
        and(eq(schema.AgentTrigger.agentId, schema.Agent.id), eq(schema.AgentTrigger.kind, 'dm'))
      )
      .where(eq(schema.Agent.organizationId, orgId))

    return Promise.all(
      rows.map(async (row): Promise<CachedAgent> => {
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
          dmEnabled: row.dmEnabled ?? false,
          dmInstructions: (row.dmInstructions ?? null) as Record<string, unknown> | null,
          dmTriggerId: row.dmTriggerId ?? null,
          config: row.config ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      })
    )
  },
}
