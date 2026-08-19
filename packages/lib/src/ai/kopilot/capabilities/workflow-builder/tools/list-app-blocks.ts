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
 *
 * ── An empty result is an ANSWER, never a failure (plan 19 §2) ──────────────
 *
 * No branch below returns `success: false` for an empty list, and a future
 * reader must not "fix" that back. This tool used to answer an empty search
 * with `{ success: false, error: 'No installed app contributes…' }`, which cost
 * a production turn ~30 of its 30 iterations: the transcript rendered
 * **`Failed: List App Blocks`** — untrue, the tool worked perfectly — and, more
 * expensively, told the model the *call* was wrong rather than that the *world*
 * was empty. The only repair a model has for a bad call is different arguments,
 * so it retried `ups`, `ups track`, `shipment track`, `tracking`… until the
 * iteration cap ended the turn. The guidance text lives in `note` now, where it
 * reads as information about the workspace instead of a defect in the call.
 *
 * `notInstalled` exists for the second half of that failure: the org had no UPS
 * block, but UPS *is* a published app — the workspace was empty, the world was
 * not, and the tool had no vocabulary for the difference. It is emitted on the
 * non-empty branch too, because "add UPS and FedEx" with only FedEx installed
 * must not surface half the answer. Matching is name/description only —
 * `CachedPublishedApp` carries no catalog — so `"invoice"` will not find
 * QuickBooks pre-install; that asymmetry is known and deferred (plan 19 §3.3).
 * When a query filters `notInstalled` down to nothing the FULL uninstalled list
 * is returned instead: the catalog is ~21 rows, and "no match for your word,
 * here is everything available" is what ends the retry loop rather than
 * extending it.
 */
export function createListAppBlocksTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_app_blocks',
    permission: workflowToolPermission('view'),
    displayName: 'List app blocks',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'List the workflow blocks contributed by apps installed in this workspace — the node types that are NOT in list_node_types. Each row carries the "<appId>:<blockId>" type add_node takes, the resources it covers, how many operations it offers, and whether the app has a workspace connection. Call describe_node_type with the type for its config schema and the full operation vocabulary. Also returns "notInstalled": published apps that are NOT installed here and could be, matched on name and description only. An empty "blocks" list is a complete answer, not an error — read "note" and move on; calling again with a reworded query returns the same thing.',
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
      const out = (output ?? {}) as { blocks?: unknown[]; notInstalled?: unknown[] }
      const blockCount = Array.isArray(out.blocks) ? out.blocks.length : 0
      const availableCount = Array.isArray(out.notInstalled) ? out.notInstalled.length : 0
      // A block-less result is still a successful answer, so the pill counts
      // what the row actually carries — "0 results" beside an install-me list
      // reads as the failure this tool no longer returns.
      return blockCount === 0 && availableCount > 0
        ? { label: 'Apps available to install', resultCount: availableCount }
        : { label: 'App blocks listed', resultCount: blockCount }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      // Lazy import — the cache module pulls server-only deps; same reason
      // get-workflow.ts defers graph-edit.
      const { getCachedInstalledApps, getCachedPublishedApps } = await import(
        '../../../../../cache'
      )
      // `publishedApps` is a GLOBAL cache key with no org scope and no DB read,
      // so the marketplace half of this answer is free.
      const [apps, published] = await Promise.all([
        getCachedInstalledApps(agentDeps.organizationId),
        getCachedPublishedApps(),
      ])

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

      // Excluded by app ID, never by slug: the slug is the marketplace-facing
      // handle and the installation carries the app's identity, so the ID is
      // the only key both sides are guaranteed to agree on.
      const installedIds = new Set(apps.map((inst) => inst.app.id))
      const uninstalled = published
        .filter((app) => !installedIds.has(app.id))
        .map((app) => ({ slug: app.slug, title: app.title, description: app.description }))

      const matched = normalizedQuery
        ? uninstalled.filter((app) =>
            [app.slug, app.title, app.description ?? ''].some((value) =>
              value.toLowerCase().includes(normalizedQuery)
            )
          )
        : uninstalled
      const showingAll = matched.length === 0
      const notInstalled = showingAll ? uninstalled : matched

      return {
        success: true,
        output: {
          blocks,
          notInstalled,
          note: buildNote({
            query,
            blockCount: blocks.length,
            availableCount: notInstalled.length,
            showingAll,
          }),
        },
      }
    },
  }
}

/**
 * The prose half of the answer — what the old `error` string used to carry,
 * minus the lie that the call failed.
 *
 * Every arm ends by telling the model the answer is complete, because the
 * behaviour being prevented is a reworded retry, and a note that only describes
 * the world leaves "maybe a different word finds it" open. The terminal arm
 * (nothing installed contributes it, nothing published provides it) says so
 * outright — that is the one case where the honest next move is to tell the
 * user it cannot be done.
 */
function buildNote(params: {
  query: string
  blockCount: number
  availableCount: number
  showingAll: boolean
}): string {
  const { query, blockCount, availableCount, showingAll } = params

  const installed =
    blockCount > 0
      ? query
        ? `${blockCount} installed app block(s) match "${query}".`
        : `${blockCount} installed app block(s) available.`
      : query
        ? `No app installed in this workspace contributes a workflow block matching "${query}".`
        : 'No app installed in this workspace contributes a workflow block.'

  if (availableCount === 0) {
    return blockCount === 0
      ? `${installed} Every published app is already installed here, so no app provides this at all. That is the complete answer — say so and stop; a reworded query returns the same thing.`
      : `${installed} Every published app is already installed here, so there is nothing further to install.`
  }

  const available =
    showingAll && query
      ? `No published app matched "${query}" by name or description either, so "notInstalled" lists every app available but not installed in this workspace — pick the one that fits or tell the user none does. Marketplace matching is name/description only, so a capability word may miss; this is still the complete answer and rewording the query will not change it.`
      : `"notInstalled" lists published apps that are NOT installed in this workspace — installing one is what makes its blocks available here. Offer the install; do not call this tool again with a reworded query.`

  return `${installed} ${available}`
}
