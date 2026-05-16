// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/update-agent-identity.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { updateAgent } from '../../../../../agents/agent-service'
import { resolveBuilderAvatar } from '../../../../../agents/builder-avatars'
import { onCacheEvent } from '../../../../../cache'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { buildAgentRailUpdate } from '../snapshot'

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
    displayName: 'Update agent identity',
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
      const { sessionContext } = getDeps()
      const agentRef = findRef(sessionContext, 'agent')
      if (!agentRef?.id) {
        return {
          success: false,
          output: null,
          error: 'No agent in session context — this tool only runs on the builder page.',
        }
      }

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
        await updateAgent(agentRef.id, agentDeps.organizationId, patch)
      }

      if (avatarAssetId !== undefined) {
        await writeAgentAvatar({
          getDeps,
          agentId: agentRef.id,
          organizationId: agentDeps.organizationId,
          avatarAssetId,
        })
      }

      const applied: Record<string, unknown> = {}
      if (name !== undefined) applied.name = name.trim()
      if (description !== undefined) applied.description = description
      if (avatarUrl !== undefined) applied.avatarUrl = avatarUrl

      const changed: Array<'identity' | 'avatar'> = []
      if (name !== undefined || description !== undefined) changed.push('identity')
      if (avatarUrl !== undefined) changed.push('avatar')

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          applied,
          ...buildAgentRailUpdate({
            agentId: agentRef.id,
            changed,
            summary: summarize(applied),
          }),
        },
      }
    },
  }
}

function summarize(applied: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof applied.name === 'string') parts.push(`name: "${applied.name}"`)
  if (typeof applied.description === 'string') parts.push('description updated')
  if (applied.description === null) parts.push('description cleared')
  if (typeof applied.avatarUrl === 'string') parts.push('avatar updated')
  return parts.join(', ')
}

async function writeAgentAvatar(params: {
  getDeps: GetToolDeps
  agentId: string
  organizationId: string
  avatarAssetId: string | null
}): Promise<void> {
  const { db } = params.getDeps()
  const [agent] = await db
    .select({ userId: schema.Agent.userId })
    .from(schema.Agent)
    .where(eq(schema.Agent.id, params.agentId))
    .limit(1)
  if (!agent) return
  await db
    .update(schema.User)
    .set({ avatarAssetId: params.avatarAssetId, updatedAt: new Date() })
    .where(eq(schema.User.id, agent.userId))

  await onCacheEvent('agent.updated', { orgId: params.organizationId })
}
