// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/describe-node-type.ts

import { z } from 'zod'
import { getManifest } from '../../../../../workflow-engine/catalog/registry'
import type { NodeManifest } from '../../../../../workflow-engine/catalog/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

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
 * guidance and worked examples. Static product data — no authorization gate.
 */
export function createDescribeNodeTypeTool(getDeps: GetToolDeps): AgentToolDefinition {
  void getDeps
  return {
    name: 'describe_node_type',
    permission: {
      target: 'none',
      note: 'Static node-type manifest (schema, connection rules, usage docs) — identical for every org, no workspace data.',
    },
    displayName: 'Describe node type',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Get one node type in full: the config schema add_node/update_node accept, its connection and branch rules, usage guidance, and worked config examples. Always call this before configuring an unfamiliar type.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: "Node type id from list_node_types (e.g. 'http')." },
      },
      required: ['type'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const type = typeof args.type === 'string' ? args.type : ''
      const manifest = getManifest(type)
      if (!manifest) {
        return {
          success: false,
          output: null,
          error: `Node type "${type}" does not exist. Call list_node_types for the catalog.`,
        }
      }

      // Branch names for the default config — branch handles can be config-
      // dependent (if-else cases), so this is a starting point; every mutation
      // result reflects the node's actual branches.
      let branches: Array<{ name: string; kind: string }> | undefined
      try {
        branches = manifest.connection.branches?.(manifest.defaultData()).map((b) => ({
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
        },
      }
    },
  }
}
