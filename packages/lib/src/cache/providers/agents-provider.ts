// packages/lib/src/cache/providers/agents-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CachedAgent } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes all agents for an organization (including archived; consumers filter). */
export const agentsProvider: CacheProvider<CachedAgent[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        id: schema.Agent.id,
        userId: schema.Agent.userId,
        name: schema.Agent.name,
        slug: schema.Agent.slug,
        description: schema.Agent.description,
        avatar: schema.Agent.avatar,
        mentionable: schema.Agent.mentionable,
        archivedAt: schema.Agent.archivedAt,
      })
      .from(schema.Agent)
      .where(eq(schema.Agent.organizationId, orgId))

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      slug: row.slug,
      description: row.description ?? null,
      avatarUrl: row.avatar ?? null,
      mentionable: row.mentionable,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    }))
  },
}
