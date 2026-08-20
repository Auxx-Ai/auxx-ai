// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/describe-node-type.ts

import { z } from 'zod'
import { getManifest } from '../../../../../workflow-engine/catalog/registry'
import type { NodeManifest } from '../../../../../workflow-engine/catalog/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { assertWorkflowAreaAccess } from './workflow-authoring-guard'

/**
 * The branch counterpart of `outputsNote`, and it exists for the same reason:
 * the list above is computed from `defaultData()`, so it describes a node the
 * caller is about to configure differently. The old docblock claimed "every
 * mutation result reflects the node's actual branches" while nothing did
 * (plan 21 §3.1); `NodeSummary.branches` made that true, and this is where the
 * caller is told to use it.
 */
function branchesNote(type: string): string {
  const shared =
    ' Address a branch by its `id`, not its display name. Every add_node/update_node/get_node ' +
    "result returns this node's ACTUAL branches with what is wired to each — read them from there."
  if (type === 'if-else') {
    return (
      'Branches depend on configuration: each `cases[]` entry is one branch, addressed by its ' +
      '`case_id`, plus the reserved `false` ELSE branch for "nothing matched". A `case_id` may ' +
      'NOT be `false` and must be unique across cases. Because you author `case_id` yourself, ' +
      'you know a branch address before the node exists — you can create the node and wire its ' +
      'branches in the same batch.' +
      shared
    )
  }
  return `Branches depend on configuration — the list above is for the DEFAULT config.${shared}`
}

/** Agent-facing config schema as JSON Schema — `agentSchema ?? configSchema`. */
function configJsonSchema(manifest: NodeManifest<unknown>): Record<string, unknown> {
  const source = manifest.agentSchema ?? manifest.configSchema
  try {
    const raw = z.toJSONSchema(source as z.ZodType, { unrepresentable: 'any' }) as Record<
      string,
      unknown
    >
    delete raw.$schema
    return raw
  } catch {
    return {}
  }
}

/**
 * Full agent-facing description of one node type (04 §1): the config schema
 * the write tools accept, connection/branch rules, the manifest's usage
 * guidance and worked examples.
 *
 * **Resolves app-block types too, and that is why this is no longer a static
 * tool.** It used to read `getManifest` — the CORE registry — so every
 * `<appId>:<blockId>` type came back "does not exist. Call list_node_types for
 * the catalog." Phase B made those types authorable, which meant the one tool
 * an agent is told to call before configuring an unfamiliar type was also the
 * one telling it the type was not real. Live in dev (plan 17 §9.1 prompt 5) the
 * agent asked for the FedEx block's schema, got that message, and refused to
 * write — twice. Handed the operation vocabulary by hand it wrote correctly on
 * the first try, so the shipped write path was never the problem; discovery
 * was.
 *
 * The synthesized manifest already carries everything rendered below, and
 * because its `resource`/`operation` are `z.enum` over the block's real ops,
 * `z.toJSONSchema` emits the operation vocabulary as an enum — exactly what was
 * missing.
 *
 * The cost is that the answer is now per-org, so the tool takes the
 * `workflowsView` area rung instead of no gate at all. Not the full
 * `resolveWorkflowAuthoring` ladder: this takes a type id, not a workflow ref,
 * and there is no instance to gate on.
 *
 * A core type never pays the org-cache read — the lookup is built only for a
 * type carrying a colon, which no core id does.
 */
export function createDescribeNodeTypeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'describe_node_type',
    permission: {
      target: 'area',
      area: 'workflows',
      level: 'view',
      enforcement: 'enforced',
      note: 'assertWorkflowAreaAccess — fail-closed on absent capabilities, then PermissionKey.workflowsView. Core node types are static product data; app-block types are this org’s installed-app catalog, which is what the gate is for.',
    },
    displayName: 'Describe node type',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Get one node type in full: the config schema add_node/update_node accept, its connection and branch rules, usage guidance, and worked config examples. Always call this before configuring an unfamiliar type.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            "Node type id from list_node_types (e.g. 'http'), or an app block's '<appId>:<blockId>' from list_app_blocks.",
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      assertWorkflowAreaAccess(getDeps().capabilities)
      const type = typeof args.type === 'string' ? args.type : ''

      // Colon pre-filter, same one `resolve-outputs` keeps: a core id never
      // contains one, so a core-only call still pays for no cache read.
      let manifest = getManifest(type)
      if (!manifest && type.includes(':')) {
        const { buildManifestLookup } = await import(
          '../../../../../workflow-engine/catalog/app-manifests'
        )
        manifest = (await buildManifestLookup(agentDeps.organizationId))(type)
      }
      if (!manifest) {
        return {
          success: false,
          output: null,
          error: type.includes(':')
            ? `Node type "${type}" is shaped like an app block (<appId>:<blockId>), but no app installed in this workspace contributes it. Call list_app_blocks for the ones that are.`
            : `Node type "${type}" does not exist. Call list_node_types for the catalog, or list_app_blocks for blocks contributed by installed apps.`,
        }
      }

      // Branches for the DEFAULT config — a starting point only, because branch
      // handles are config-dependent (if-else cases, a classifier's categories,
      // http/crud's gated `fail`). The node's real branches ride every
      // add_node/update_node/get_node result via `NodeSummary.branches`.
      //
      // The `id` is kept. It used to be stripped, leaving `{name, kind}` — and
      // the id is the ADDRESS, the thing `branch` resolves to and the thing
      // `graphSummary.edges[].branch` renders, while the name for an if-else is
      // derived from array position and renames itself as cases are added
      // (plan 21 §3.1/§10.2).
      let branches: Array<{ id: string; name: string; kind: string }> | undefined
      try {
        branches = manifest.connection.branches?.(manifest.defaultData()).map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
        }))
      } catch {
        branches = undefined
      }

      const connection = {
        canConnect: manifest.connection.canConnect !== false,
        ...(manifest.connection.maxIncomingConnections !== undefined
          ? { maxIncomingConnections: manifest.connection.maxIncomingConnections }
          : {}),
        ...(manifest.connection.maxOutgoingConnections !== undefined
          ? { maxOutgoingConnections: manifest.connection.maxOutgoingConnections }
          : {}),
        ...(branches && branches.length > 0 ? { branches } : {}),
      }

      return {
        success: true,
        output: {
          type: manifest.id,
          displayName: manifest.displayName,
          description: manifest.description,
          category: manifest.category,
          ...(manifest.triggerType ? { isTrigger: true } : {}),
          authorable: manifest.agent?.authorable === true,
          configSchema: configJsonSchema(manifest),
          connection,
          ...(manifest.agent?.usage ? { usage: manifest.agent.usage } : {}),
          ...(manifest.agent?.examples?.length ? { examples: manifest.agent.examples } : {}),
          outputsNote:
            'Outputs depend on configuration — every add_node/update_node result (and get_node) returns this node’s resolved outputs; wire references from those.',
          ...(branches && branches.length > 0 ? { branchesNote: branchesNote(manifest.id) } : {}),
        },
      }
    },
  }
}
