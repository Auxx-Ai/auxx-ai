// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-toolsets.ts

import { batchUpdateAgentToolsets } from '../../../../../agents/agent-toolset-service'
import {
  getOrgToolsetCatalog,
  getOrgToolsetCatalogForSurface,
  type ToolsetCatalogEntry,
} from '../../../../../agents/toolset-catalog'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveAgentAuthoring } from './agent-authoring-guard'

const MAX_TOOLSETS = 50

/**
 * Replace the agent's full toolset configuration. Send every toolset you want
 * enabled with `enabled: true`; toolsets omitted from the list are NOT
 * touched. To disable a toolset, send it explicitly with `enabled: false`.
 */
export function createSetAgentToolsetsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_toolsets',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Set agent toolsets',
    // Builder-only meta-tool. See plans/chat/v6/chat-tool-availability.md.
    surfaces: ['builder'],
    description: `Update the agent's toolset configuration.

Each row patches the agent's record for one toolset slug:
- enabled: true|false — turn the toolset on/off
- enabledTools: for MCP server toolsets only — the exact list of tool names
  the agent may use (an allow-list; tools not listed stay off). Omit it to
  leave the current selection unchanged, or to enable all current tools when
  turning the toolset on for the first time.

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
              enabledTools: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Allow-list of tool names within the toolset (MCP servers). Must match the catalog. Omit to leave the current selection unchanged.',
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
      const auth = await resolveAgentAuthoring(getDeps, agentDeps)
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const { agentId, agent } = auth

      const toolsets = (args.toolsets ?? []) as Array<{
        slug: string
        enabled: boolean
        enabledTools?: string[]
      }>

      if (!Array.isArray(toolsets) || toolsets.length === 0) {
        return { success: false, output: null, error: 'toolsets array must have at least one row' }
      }

      // Chat-kind agents validate against the chat-surface catalog — the same
      // toolsets their builder persona advertised and the only ones that survive
      // `buildChatEngineConfig`'s runtime surface filter. A slug narrowed off
      // chat therefore errors here instead of being silently dropped at runtime.
      // See plans/chat/v6/chat-tool-availability.md. The agent row comes from
      // the authorization guard — same org-scoped cache read, one lookup.
      const catalog =
        agent.kind === 'chat'
          ? await getOrgToolsetCatalogForSurface(agentDeps.organizationId, 'chat')
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
        if (row.enabledTools && row.enabledTools.length > 0) {
          const validNames = new Set(entry.tools.map((t) => t.name))
          for (const name of row.enabledTools) {
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
        agentId,
        toolsets.map((row) => ({
          slug: row.slug,
          enabled: row.enabled,
          ...(row.enabledTools !== undefined ? { enabledTools: row.enabledTools } : {}),
        }))
      )

      const enabledCount = toolsets.filter((t) => t.enabled).length
      const totalToolsAvailable = toolsets
        .filter((t) => t.enabled)
        .reduce((sum, t) => {
          const entry = catalogBySlug.get(t.slug)
          if (!entry) return sum
          return sum + (t.enabledTools !== undefined ? t.enabledTools.length : entry.tools.length)
        }, 0)

      return {
        success: true,
        output: {
          agentId,
          enabledCount,
          totalToolsAvailable,
        },
      }
    },
  }
}
