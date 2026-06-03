// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-restrictions.ts

import type { ArgRestriction, RestrictionSource, ToolRestrictionMap } from '@auxx/database'
import { buildRestrictionVarRegistry } from '../../../../../agents/restrictions'
import { setAgentToolRestrictions } from '../../../../../agents/set-tool-restrictions'
import { getCachedAgentById, getOrgCache } from '../../../../../cache'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

const MAX_RESTRICTIONS = 50

interface RestrictionRow {
  tool: string
  arg: string
  source: RestrictionSource
  var?: string
  value?: unknown
  required?: boolean
}

/**
 * Set the agent's tool restrictions (`Agent.toolRestrictions`) — a **bespoke**
 * authoring path for the builder Kopilot, parallel to `set_agent_toolsets`.
 *
 * Most identity scoping is created automatically when a tool is enabled (see
 * plans/chat/v6 phase-6 §1); this tool exists for explicit admin asks ("also
 * lock the email arg to the visitor", "pin region to EU", "remove the lock on
 * customerId"). It is a **full-replace** write — send every restriction you want
 * to keep. An empty array clears all restrictions.
 *
 * Validation: each row's `tool` must be enabled on the agent, `arg` must exist
 * in that tool's current input schema, and `var` rows must reference a known var
 * id. Structural checks (`constant` needs a `value`, `var` id must be
 * well-formed) are re-enforced by `setAgentToolRestrictions`.
 */
export function createSetAgentRestrictionsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_restrictions',
    displayName: 'Set agent restrictions',
    // Builder-only meta-tool. See plans/chat/v6/chat-tool-availability.md.
    surfaces: ['builder'],
    description: `Lock individual tool arguments to a fixed value or a visitor/thread var. FULL REPLACE — send every restriction you want to keep; an empty array clears them all.

Each row:
- tool: the tool's registered name (must be enabled on the agent)
- arg: the argument name on that tool
- source: 'var' (bind to a visitor/thread var), 'constant' (pin a literal), or 'model' (leave to the LLM)
- var: required when source='var' — a var id like 'visitor:self' or 'visitor:contact:primary_email'
- value: required when source='constant' — the literal value to inject
- required: when true, the call is refused if the resolved value is null (use with source='var' for identity gating)

Most identity scoping (e.g. order lookups → the signed-in visitor) is created automatically when you enable the tool — only call this for explicit, non-default locks the admin asks for.`,
    parameters: {
      type: 'object',
      properties: {
        restrictions: {
          type: 'array',
          maxItems: MAX_RESTRICTIONS,
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              arg: { type: 'string' },
              source: { type: 'string', enum: ['model', 'var', 'constant'] },
              var: { type: 'string' },
              value: {},
              required: { type: 'boolean' },
            },
            required: ['tool', 'arg', 'source'],
            additionalProperties: false,
          },
        },
      },
      required: ['restrictions'],
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

      const rows = (args.restrictions ?? []) as RestrictionRow[]
      if (!Array.isArray(rows)) {
        return { success: false, output: null, error: 'restrictions must be an array' }
      }

      const { organizationId } = agentDeps
      const agent = await getCachedAgentById(organizationId, agentRef.id)
      if (!agent) {
        return { success: false, output: null, error: `Agent not found: ${agentRef.id}` }
      }

      // Build the registered-name → arg-names map for the agent's enabled tools.
      const enabledSlugs = new Set(agent.toolsets.filter((t) => t.enabled).map((t) => t.slug))
      const installedApps = await getOrgCache().get(organizationId, 'installedApps')
      const argsByTool = new Map<string, Set<string>>()
      for (const app of installedApps) {
        for (const tool of app.agentTools ?? []) {
          if (!enabledSlugs.has(tool.toolsetSlug)) continue
          const schema = tool.inputsJsonSchema as
            | { properties?: Record<string, unknown> }
            | undefined
          const argNames = new Set(Object.keys(schema?.properties ?? {}))
          argsByTool.set(tool.registeredName, argNames)
        }
      }

      const varIds = new Set((await buildRestrictionVarRegistry(organizationId)).map((v) => v.id))

      const map: ToolRestrictionMap = {}
      for (const row of rows) {
        const argNames = argsByTool.get(row.tool)
        if (!argNames) {
          return {
            success: false,
            output: null,
            error: `Tool "${row.tool}" is not enabled on this agent. Enable its toolset first with set_agent_toolsets.`,
          }
        }
        // App input schemas don't always enumerate every arg; only reject when
        // the schema lists args and this one isn't among them.
        if (argNames.size > 0 && !argNames.has(row.arg)) {
          return {
            success: false,
            output: null,
            error: `Tool "${row.tool}" has no argument named "${row.arg}". Valid args: ${[...argNames].join(', ')}.`,
          }
        }
        if (row.source === 'var') {
          if (!row.var) {
            return {
              success: false,
              output: null,
              error: `Row for ${row.tool}.${row.arg} has source='var' but no var id.`,
            }
          }
          // Accept registry vars and well-formed anchor ids (hidden app fields
          // like Shopify's customerId are excluded from the picker registry yet
          // still resolve — mirrors the service's warn-not-reject stance).
          if (!varIds.has(row.var) && !parsesAsAnchorVarId(row.var)) {
            return {
              success: false,
              output: null,
              error: `Unknown var id "${row.var}" for ${row.tool}.${row.arg}.`,
            }
          }
        }
        if (row.source === 'constant' && row.value === undefined) {
          return {
            success: false,
            output: null,
            error: `Row for ${row.tool}.${row.arg} has source='constant' but no value.`,
          }
        }

        const restriction: ArgRestriction = { source: row.source }
        if (row.var !== undefined) restriction.var = row.var
        if (row.value !== undefined) restriction.value = row.value
        if (row.required !== undefined) restriction.required = row.required

        const perTool = map[row.tool] ?? {}
        perTool[row.arg] = restriction
        map[row.tool] = perTool
      }

      await setAgentToolRestrictions({ organizationId, agentId: agentRef.id, restrictions: map })

      return {
        success: true,
        output: { agentId: agentRef.id, restrictionCount: rows.length },
      }
    },
  }
}

/** `<anchor>:<ref>` with `anchor ∈ {visitor, thread}` and a non-empty `ref`. */
function parsesAsAnchorVarId(varId: string): boolean {
  const idx = varId.indexOf(':')
  if (idx <= 0 || idx === varId.length - 1) return false
  const anchor = varId.slice(0, idx)
  return anchor === 'visitor' || anchor === 'thread'
}
