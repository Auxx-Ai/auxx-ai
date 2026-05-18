// packages/lib/src/cache/providers/agents-provider.ts

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { MediaAssetService } from '../../files'
import { createScopedLogger } from '../../logger'
import type { CachedAgent } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('agents-provider')

/**
 * Computes all agents for an organization (including archived; consumers filter).
 *
 * `name` and the avatar URL are pulled from the backing User row — agents don't
 * store those columns themselves. Avatars use the standard MediaAsset pipeline
 * (`User.avatarAssetId` → `MediaAssetService.getDownloadUrl`), the same path
 * humans go through.
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
        createdAt: schema.Agent.createdAt,
        updatedAt: schema.Agent.updatedAt,
        userName: schema.User.name,
        avatarAssetId: schema.User.avatarAssetId,
        dmTriggerId: schema.AgentTrigger.id,
        dmEnabled: schema.AgentTrigger.enabled,
        dmInstructions: schema.AgentTrigger.instructions,
      })
      .from(schema.Agent)
      .innerJoin(schema.User, eq(schema.User.id, schema.Agent.userId))
      .leftJoin(
        schema.AgentTrigger,
        and(eq(schema.AgentTrigger.agentId, schema.Agent.id), eq(schema.AgentTrigger.kind, 'dm'))
      )
      .where(eq(schema.Agent.organizationId, orgId))

    return Promise.all(
      rows.map(async (row): Promise<CachedAgent> => {
        let avatarUrl: string | null = null
        if (row.avatarAssetId) {
          const mediaAssetService = new MediaAssetService(orgId, row.userId, db)
          try {
            avatarUrl = await mediaAssetService.getDownloadUrl(row.avatarAssetId)
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
          name: row.userName ?? null,
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
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      })
    )
  },
}
