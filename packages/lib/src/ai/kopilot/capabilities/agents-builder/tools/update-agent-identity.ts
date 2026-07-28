// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/update-agent-identity.ts

import { type AgentConfig, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { updateAgent } from '../../../../../agents/agent-service'
import { resolveBuilderAvatar } from '../../../../../agents/builder-avatars'
import { onCacheEvent } from '../../../../../cache'
import { getRealtimeService, publishAgentUpdated } from '../../../../../realtime'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveAgentAuthoring } from './agent-authoring-guard'

const NAME_MAX = 100
const DESCRIPTION_MAX = 280

/**
 * Update one or more identity fields on the agent currently bound to the
 * builder session. `name` / `description` route through `updateAgent` (which
 * writes name to the backing `User` row). `avatarSlug` resolves through the
 * curated builder-avatar pool and is written to the backing User's avatar.
 */
export function createUpdateAgentIdentityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_agent_identity',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'admin',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Update agent identity',
    // Builder-only meta-tool. See plans/chat/v6/chat-tool-availability.md.
    surfaces: ['builder'],
    description: `Update the agent's identity — any subset of name, description, avatarSlug.

Provide ONLY the fields you want to change; omitted fields are left alone. At
least one field is required. The agent is the one referenced in this session's
active references — you do NOT pass an agentId.

- name: human-friendly label (1–${NAME_MAX} chars)
- description: one-line summary shown to admins (≤${DESCRIPTION_MAX} chars, pass null to clear)
- avatarSlug: pick one from the BUILDER_AVATAR_POOL (announced in your persona).
  Resolves to a curated illustration; rejects unknown slugs loudly.`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'New display name',
          minLength: 1,
          maxLength: NAME_MAX,
        },
        description: {
          type: ['string', 'null'],
          description: 'One-line summary; pass null to clear',
          maxLength: DESCRIPTION_MAX,
        },
        avatarSlug: {
          type: 'string',
          description: 'Curated avatar slug from the announced pool',
          pattern: '^[a-z0-9-]+$',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveAgentAuthoring(getDeps, agentDeps, 'admin')
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const { agentId } = auth

      const name = args.name as string | undefined
      const description = args.description as string | null | undefined
      const avatarSlug = args.avatarSlug as string | undefined

      if (name === undefined && description === undefined && avatarSlug === undefined) {
        return {
          success: false,
          output: null,
          error: 'Provide at least one of: name, description, avatarSlug.',
        }
      }

      if (name !== undefined) {
        const trimmed = name.trim()
        if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
          return {
            success: false,
            output: null,
            error: `name must be 1–${NAME_MAX} characters`,
          }
        }
      }
      if (typeof description === 'string' && description.length > DESCRIPTION_MAX) {
        return {
          success: false,
          output: null,
          error: `description exceeds max ${DESCRIPTION_MAX} chars`,
        }
      }

      let avatarUrl: string | null | undefined
      let avatarAssetId: string | null | undefined
      if (avatarSlug !== undefined) {
        const resolved = resolveBuilderAvatar(avatarSlug)
        if (!resolved) {
          return {
            success: false,
            output: null,
            error: `Unknown avatarSlug "${avatarSlug}". Pick from the announced BUILDER_AVATAR_POOL.`,
          }
        }
        avatarUrl = resolved.url
        avatarAssetId = resolved.assetId
      }

      const patch: Parameters<typeof updateAgent>[2] = {}
      if (name !== undefined) patch.name = name.trim()
      if (description !== undefined) patch.description = description

      if (Object.keys(patch).length > 0) {
        await updateAgent(agentId, agentDeps.organizationId, patch)
      }

      if (avatarAssetId !== undefined) {
        await writeAgentAvatar({
          getDeps,
          agentId,
          organizationId: agentDeps.organizationId,
          avatarAssetId,
        })
      }

      const applied: Record<string, unknown> = {}
      if (name !== undefined) applied.name = name.trim()
      if (description !== undefined) applied.description = description
      if (avatarUrl !== undefined) applied.avatarUrl = avatarUrl

      return {
        success: true,
        output: {
          agentId,
          applied,
        },
      }
    },
  }
}

async function writeAgentAvatar(params: {
  getDeps: GetToolDeps
  agentId: string
  organizationId: string
  avatarAssetId: string | null
}): Promise<void> {
  const { db } = params.getDeps()
  const [agent] = await db
    .select({ userId: schema.Agent.userId, config: schema.Agent.config })
    .from(schema.Agent)
    .where(eq(schema.Agent.id, params.agentId))
    .limit(1)
  if (!agent) return

  if (agent.userId) {
    await db
      .update(schema.User)
      .set({ avatarAssetId: params.avatarAssetId, updatedAt: new Date() })
      .where(eq(schema.User.id, agent.userId))
  } else {
    // Draft (Option D): no backing User yet. Stash the chosen assetId on
    // Agent.config so the cache provider's fallback picks it up; on
    // completeAgentSetup the value is mirrored onto User.avatarAssetId.
    // When the v1 builder pool resolves to assetId=null this is a true
    // no-op (we don't bother writing the empty key).
    const current = (agent.config ?? {}) as AgentConfig
    const next: AgentConfig = { ...current }
    if (params.avatarAssetId) next.avatarAssetId = params.avatarAssetId
    else delete next.avatarAssetId
    await db
      .update(schema.Agent)
      .set({ config: next, updatedAt: new Date() })
      .where(eq(schema.Agent.id, params.agentId))
  }

  await onCacheEvent('agent.updated', { orgId: params.organizationId })
  await publishAgentUpdated(getRealtimeService(), params.organizationId, {
    agentId: params.agentId,
  })
}
