// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-toolsets.ts

import { batchUpdateAgentToolsets } from '../../../../../agents/agent-toolset-service'
import {
  getOrgChatSafeToolsetCatalog,
  getOrgToolsetCatalog,
  type ToolsetCatalogEntry,
} from '../../../../../agents/toolset-catalog'
import { getCachedAgentById } from '../../../../../cache'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

const MAX_TOOLSETS = 50

/**
 * Replace the agent's full toolset configuration. Send every toolset you want
 * enabled with `enabled: true`; toolsets omitted from the list are NOT
 * touched. To disable a toolset, send it explicitly with `enabled: false`.
 */
export function createSetAgentToolsetsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_toolsets',
    displayName: 'Set agent toolsets',
    description: `Update the agent's toolset configuration.

Each row patches the agent's record for one toolset slug:
- enabled: true|false — turn the toolset on/off
- disabledTools: optional list of tool names to hide from the agent even
  when the toolset is enabled

The full toolset catalog is in your persona prompt. Pass the slugs you want
to change; omitted slugs are left alone.`,
    parameters: {
      type: 'object',
      properties: {
        toolsets: {
          type: 'array',
          maxItems: MAX_TOOLSETS,
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Toolset slug from the catalog' },
              enabled: { type: 'boolean' },
              disabledTools: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Tool names within the toolset to hide. Must match the catalog. Omit to leave the per-tool disable list unchanged.',
              },
            },
            required: ['slug', 'enabled'],
            additionalProperties: false,
          },
        },
      },
      required: ['toolsets'],
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

      const toolsets = (args.toolsets ?? []) as Array<{
        slug: string
        enabled: boolean
        disabledTools?: string[]
      }>

      if (!Array.isArray(toolsets) || toolsets.length === 0) {
        return { success: false, output: null, error: 'toolsets array must have at least one row' }
      }

      // Chat-kind agents validate against the chat-safe catalog only — the
      // same surface their builder persona advertised and the only toolsets
      // that survive `buildChatEngineConfig`'s runtime filter. A non-safe slug
      // for a chat agent therefore errors here instead of being silently
      // dropped at chat runtime. See plans/chat/v5 phase-2b.
      const agent = await getCachedAgentById(agentDeps.organizationId, agentRef.id)
      const catalog =
        agent?.kind === 'chat'
          ? await getOrgChatSafeToolsetCatalog(agentDeps.organizationId)
          : await getOrgToolsetCatalog(agentDeps.organizationId)
      const catalogBySlug = new Map<string, ToolsetCatalogEntry>(
        catalog.map((entry) => [entry.slug, entry])
      )

      for (const row of toolsets) {
        const entry = catalogBySlug.get(row.slug)
        if (!entry) {
          return {
            success: false,
            output: null,
            error: `Unknown toolset slug "${row.slug}". Pick from the catalog in your persona prompt.`,
          }
        }
        if (row.disabledTools && row.disabledTools.length > 0) {
          const validNames = new Set(entry.tools.map((t) => t.name))
          for (const name of row.disabledTools) {
            if (!validNames.has(name)) {
              return {
                success: false,
                output: null,
                error: `Toolset "${row.slug}" does not contain a tool named "${name}". Valid tools: ${entry.tools.map((t) => t.name).join(', ')}.`,
              }
            }
          }
        }
      }

      await batchUpdateAgentToolsets(
        agentDeps.organizationId,
        agentRef.id,
        toolsets.map((row) => ({
          slug: row.slug,
          enabled: row.enabled,
          ...(row.disabledTools !== undefined ? { disabledTools: row.disabledTools } : {}),
        }))
      )

      const enabledCount = toolsets.filter((t) => t.enabled).length
      const totalToolsAvailable = toolsets
        .filter((t) => t.enabled)
        .reduce((sum, t) => {
          const entry = catalogBySlug.get(t.slug)
          if (!entry) return sum
          const disabledCount = t.disabledTools?.length ?? 0
          return sum + Math.max(0, entry.tools.length - disabledCount)
        }, 0)

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          enabledCount,
          totalToolsAvailable,
        },
      }
    },
  }
}
