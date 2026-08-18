// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/list-app-blocks.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

/**
 * The workflow blocks this org's installed apps contribute (plan 17 §6, C1).
 *
 * `list_node_types` reads `listManifests()` — the core registry — and app
 * blocks are deliberately never registered there (`catalog-coverage.test.ts`
 * asserts exact set equality between the `NodeType` enum and
 * {registered manifests ∪ `NOT_YET_MIGRATED`}, and an app block is in neither).
 * So the two lists cannot merge, and without this tool an installed block is
 * unreachable by name: live in dev (§9.1 prompt 8) `list_node_types` was asked
 * for "quickbooks", answered "No node types match", and the agent concluded
 * QuickBooks was unavailable — while it was installed and contributing a block.
 * A false negative, not a missing feature.
 *
 * One row per installed block, deliberately compact: this is discovery, and the
 * operation vocabulary belongs to `describe_node_type`, which now returns it as
 * an enum on `configSchema.properties.operation`.
 *
 * `resources` + `operationCount` rather than the operation list, because the
 * list does not stay small: quickbooks declares **42** operations and shopify
 * **64**, so an unfiltered call that spelled them all out would spend thousands
 * of characters on a tool whose only job is "which blocks exist". The `query`
 * filter still matches operation names, so searching "invoice" finds the
 * QuickBooks block — you just get the block, not its whole vocabulary.
 *
 * `connected` is the denormalized `orgConnectionPresent` already on
 * `CachedInstalledApp` — no extra read. It is surfaced because a block whose
 * app has no workspace connection produces a tier-2 `error` the moment it is
 * added, and an agent that can see that up front can say so instead of
 * authoring a node that is guaranteed not to run.
 */
export function createListAppBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_app_blocks',
    permission: workflowToolPermission('view'),
    displayName: 'List app blocks',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'List the workflow blocks contributed by apps installed in this workspace — the node types that are NOT in list_node_types. Each row carries the "<appId>:<blockId>" type add_node takes, the resources it covers, how many operations it offers, and whether the app has a workspace connection. Call describe_node_type with the type for its config schema and the full operation vocabulary.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional free-text search over app name, block label, description, and operation names.',
        },
      },
      additionalProperties: false,
    },
    buildDigest: (output) => {
      const out = (output ?? {}) as { blocks?: unknown[] }
      return {
        label: 'App blocks listed',
        resultCount: Array.isArray(out.blocks) ? out.blocks.length : 0,
      }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      // Lazy import — the cache module pulls server-only deps; same reason
      // get-workflow.ts defers graph-edit.
      const { getCachedInstalledApps } = await import('../../../../../cache')
      const apps = await getCachedInstalledApps(agentDeps.organizationId)

      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const normalizedQuery = query.toLowerCase()

      const blocks = apps
        .flatMap((inst) =>
          (inst.workflowBlocks ?? []).map((block) => ({
            opKeys: block.ops.map((op) => `${op.resource}.${op.operation}`),
            row: {
              type: `${inst.app.id}:${block.id}`,
              app: inst.app.title,
              appSlug: inst.app.slug,
              label: block.label || block.id,
              description: block.description || `${inst.app.title} block`,
              resources: [...new Set(block.ops.map((op) => op.resource))],
              operationCount: block.ops.length,
              // `undefined` means UNKNOWN, not false — a catalog published before
              // the field existed simply does not say. Omitted rather than
              // defaulted, so the agent never reads a guess as a fact.
              ...(block.requiresConnection !== undefined
                ? { requiresConnection: block.requiresConnection }
                : {}),
              connected: inst.orgConnectionPresent,
            },
          }))
        )
        // Search over the operation KEYS too, even though they are not emitted:
        // "find me the invoice block" is exactly how this tool gets used, and
        // the block is the answer — its vocabulary is one describe_node_type
        // away.
        .filter(
          ({ row, opKeys }) =>
            !normalizedQuery ||
            [row.type, row.app, row.appSlug, row.label, row.description, ...opKeys].some((value) =>
              value.toLowerCase().includes(normalizedQuery)
            )
        )
        .map(({ row }) => row)
        .sort((a, b) => a.type.localeCompare(b.type))

      if (blocks.length === 0) {
        return {
          success: false,
          output: null,
          error: query
            ? `No installed app contributes a workflow block matching "${query}". Call list_app_blocks without a query to see them all.`
            : 'No app installed in this workspace contributes a workflow block. Apps are installed from Settings → Apps.',
        }
      }
      return { success: true, output: { blocks } }
    },
  }
}
