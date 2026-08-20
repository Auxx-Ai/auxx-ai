// packages/lib/src/workflows/graph-edit/read.ts

/**
 * Draft reads for the graph-edit module (`03-graph-edit-service.md` §1) —
 * SERVER-ONLY (org cache + db). Loads the draft `Workflow` row that
 * `WorkflowApp.draftWorkflowId` points at and renders it for a headless
 * caller: friendly refs everywhere (`{{Title.path}}`, resource slugs), never
 * raw node ids or per-org CUIDs.
 *
 * No permission checks live here (house rule): callers must assert edit/view
 * access (`capabilities.assert*Instance('workflow', id)`) and
 * `assertWorkflowAppNotSystemOwned` before calling in.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { type AuxxError, NotFoundError } from '../../errors'
import { buildManifestLookup } from '../../workflow-engine/catalog/app-manifests'
import { isDerivedKey, stripDerivedKeys } from '../../workflow-engine/catalog/derived-keys'
import {
  dehydrateGraph,
  type GraphDocument,
  hydrateGraph,
} from '../../workflow-engine/catalog/graph-hydration'
import {
  DEHYDRATION_OPTIONS,
  HYDRATION_OPTIONS,
} from '../../workflow-engine/catalog/hydration-policy'
import { resolveGraphOutputs } from '../../workflow-engine/catalog/resolve-outputs'
import type { ManifestLookup } from '../../workflow-engine/catalog/types'
import type { UnifiedVariable } from '../../workflow-engine/types/unified-variable'
import { hashWorkflowGraph } from '../graph-hash'
import { buildBranchSummaries } from './branches'
import { type ResourceAliasIndex, renderPersistedRefs } from './normalize/friendly-refs'
import { checkVariableRefsAgainstOutputs } from './normalize/ref-check'
import { buildResourceAliasIndex } from './normalize/resource-refs'
import { formatNodeRef } from './refs'
import type {
  DraftGraph,
  DraftSummary,
  EdgeSummary,
  GraphNode,
  GraphSummary,
  Issue,
  NodeSummary,
} from './types'
import {
  nodeType,
  validateBranchWiring,
  validateGraphStructure,
  validateNodeConfigs,
} from './validate'

/** Everything a mutation or read needs about the loaded draft. */
export interface DraftContext {
  workflowAppId: string
  organizationId: string
  appName: string
  appDescription: string | null
  /** The raw draft `Workflow` row (null when the app has no draft yet). */
  draftRow: Record<string, unknown> | null
  graph: DraftGraph
  /** CAS token — hash of the RAW stored graph; undefined when there is none yet. */
  graphHash?: string
  /**
   * Hash of `graph` **dehydrated** — i.e. of exactly the bytes a persist of an
   * unchanged graph would write.
   *
   * Separate from {@link graphHash} because that one must stay a hash of the
   * raw column (it is the CAS token, re-checked against the column inside the
   * save transaction). `ops.ts`'s no-op short-circuit asks a different
   * question — "would writing this change anything?" — and since a stored row
   * may still be in the pre-canonicalization fat shape, the raw hash is the
   * wrong baseline for it: a load-then-save of an untouched fat graph is a
   * genuine byte change (the canonicalization) but not an authored one.
   */
  canonicalGraphHash: string
  triggerType?: string | null
  /**
   * Core registry ∪ this org's installed app blocks, built once per operation.
   *
   * Deliberately built here rather than memoized somewhere longer-lived: the
   * `installedApps` cache behind it has a 900s TTL, and a lookup pinned across
   * operations would let two tool calls in one turn disagree about a block's
   * shape with nothing able to invalidate the difference.
   */
  lookup: ManifestLookup
}

/** Scope every operation takes. */
export interface GraphEditScope {
  workflowAppId: string
  organizationId: string
}

/**
 * Normalize whatever the jsonb column holds into a well-formed graph doc — the
 * Kopilot read boundary (plan 23 §4.2).
 *
 * {@link hydrateGraph} does the array guards itself, so a malformed row still
 * degrades to an empty document rather than throwing.
 *
 * ORDER (plan 23 §3.2): `loadDraftContext` mints `graphHash` from the RAW
 * column, never from this result — see the comment at its call site.
 */
function toDraftGraph(raw: unknown): DraftGraph {
  const graph = hydrateGraph((raw ?? {}) as GraphDocument, HYDRATION_OPTIONS)
  return {
    nodes: graph.nodes as unknown as DraftGraph['nodes'],
    edges: graph.edges as unknown as DraftGraph['edges'],
    ...(graph.viewport ? { viewport: graph.viewport } : {}),
  }
}

/**
 * Load the workflow app + its draft graph. A missing draft row is NOT an
 * error — the app then edits as an empty graph and `WorkflowService.update`
 * creates the draft on first persist.
 */
export async function loadDraftContext(
  db: Database,
  params: GraphEditScope
): Promise<Result<DraftContext, AuxxError>> {
  const { workflowAppId, organizationId } = params
  const app = await db.query.WorkflowApp.findFirst({
    where: and(
      eq(schema.WorkflowApp.id, workflowAppId),
      eq(schema.WorkflowApp.organizationId, organizationId)
    ),
    with: { draftWorkflow: true },
  })
  if (!app) return err(new NotFoundError('Workflow not found'))

  const draftRow = (app.draftWorkflow ?? null) as Record<string, unknown> | null
  const rawGraph = draftRow?.graph
  const lookup = await buildManifestLookup(organizationId)
  // The CAS token is minted from the RAW column and re-checked against the raw
  // column inside `WorkflowService.update`'s transaction (plan 23 §3.2). It
  // must never be taken from the hydrated `graph` below.
  const graph = toDraftGraph(rawGraph)
  return ok({
    workflowAppId,
    organizationId,
    appName: app.name,
    appDescription: app.description,
    draftRow,
    graph,
    ...(rawGraph ? { graphHash: hashWorkflowGraph(rawGraph) } : {}),
    // The no-op short-circuit's baseline — see `DraftContext.canonicalGraphHash`.
    canonicalGraphHash: hashWorkflowGraph(
      dehydrateGraph(graph as unknown as GraphDocument, DEHYDRATION_OPTIONS)
    ),
    triggerType: (draftRow?.triggerType as string | null | undefined) ?? null,
    lookup,
  })
}

/**
 * Data keys that are identity/bookkeeping, not config — withheld from summaries.
 *
 * `appId`/`appSlug`/`blockId` are an app block's identity, stamped by
 * `add_node` from the synthesized manifest's `defaultData` and never settable:
 * `appId` and `blockId` are already the two halves of `type`, and re-emitting
 * all three in every node summary spent space on every read for nothing.
 * Withholding them also makes them durable — the `patches` path deletes every
 * key the summary showed before re-applying, so a key that is not in the
 * summary survives the write untouched. `connectionId` and `fieldModes` stay in
 * config on purpose: both are agent-settable.
 */
const NON_CONFIG_KEYS = new Set([
  'id',
  'type',
  'title',
  'appId',
  'appSlug',
  'blockId',
  'desc',
  'icon',
  'selected',
  'isValid',
  'errors',
  'disabled',
  'isInLoop',
  'loopId',
  'width',
  'height',
  'variables',
  'outputVariables',
  // Legacy only: the manual trigger's mirrored connected-input id list. No
  // writer produces it any more (`catalog/nodes/manual.ts`) and it is gone from
  // the schema, so `describe_node_type` no longer offers it — but stored rows
  // still carry it, and echoing a list that drifted from the edges in 7 of 8
  // workflows is exactly what made it worth deleting.
  'inputNodes',
  // Legacy only: a vestigial alias of `desc` that five manifests used to mint
  // and nothing ever read (`catalog/node-base.ts`). It is gone from the schemas,
  // so `describe_node_type` no longer offers it — but ~209 stored graphs still
  // carry it, and echoing an empty `description` beside a real `desc` we already
  // withhold is exactly backwards.
  'description',
])

/** Hash durable node data only; derived keys are regenerated and stripped on save. */
export function hashNodeConfig(data: Record<string, unknown>): string {
  return hashWorkflowGraph(stripDerivedKeys(data))
}

/**
 * One node's summary: friendly ref + friendly-rendered config + the node's
 * actual branches.
 *
 * `lookup` is optional only because two internal callers read nothing but
 * `config` off the result (the patch path's before-image). Pass it wherever the
 * summary is RETURNED to a caller: without it `branches` is silently absent,
 * and the whole point of the field is that a branching node never comes back
 * without its vocabulary attached.
 */
export function buildNodeSummary(
  graph: DraftGraph,
  node: GraphNode,
  aliases?: ResourceAliasIndex,
  lookup?: ManifestLookup
): NodeSummary {
  const config: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((node.data ?? {}) as Record<string, unknown>)) {
    if (isDerivedKey(key) || NON_CONFIG_KEYS.has(key)) continue
    config[key] = value
  }
  const container = node.parentId ?? (node.data?.loopId as string | undefined)
  const branches = lookup ? buildBranchSummaries(graph, node, lookup(nodeType(node))) : undefined
  return {
    ref: formatNodeRef(graph.nodes, node.id),
    id: node.id,
    type: nodeType(node),
    title: typeof node.data?.title === 'string' ? node.data.title : '',
    configHash: hashNodeConfig((node.data ?? {}) as Record<string, unknown>),
    ...(container ? { inside: formatNodeRef(graph.nodes, container) } : {}),
    position: node.position ?? { x: 0, y: 0 },
    config: renderPersistedRefs(config, { nodes: graph.nodes, resourceAliases: aliases }),
    ...(branches ? { branches } : {}),
  }
}

/** Compact graph summary with friendly refs. */
export function buildGraphSummary(
  graph: DraftGraph,
  lookup: ManifestLookup,
  triggerType?: string | null
): GraphSummary {
  const edges: EdgeSummary[] = graph.edges.map((edge) => {
    const handle = edge.sourceHandle ?? 'source'
    return {
      from: formatNodeRef(graph.nodes, edge.source),
      to: formatNodeRef(graph.nodes, edge.target),
      ...(handle !== 'source' ? { branch: handle } : {}),
      ...(edge.data?.isLoopBackEdge || edge.targetHandle === 'loop-back'
        ? { isLoopBack: true }
        : {}),
    }
  })
  // Nodes with no catalog manifest are read-only to this editor. Reported here
  // once instead of as a repeated per-node `info` issue — see GraphSummary.
  // Read through `lookup`, so a block from an app THIS org has installed is no
  // longer listed: it is authorable now. What stays listed is what genuinely is
  // read-only — an unmigrated core type, or an orphan node whose app was
  // uninstalled or whose deployment dropped the block.
  const readOnlyNodes = graph.nodes
    .filter((node) => !lookup(nodeType(node)))
    .map((node) => formatNodeRef(graph.nodes, node.id))

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodes: graph.nodes.map((node) => {
      const container = node.parentId ?? (node.data?.loopId as string | undefined)
      return {
        ref: formatNodeRef(graph.nodes, node.id),
        type: nodeType(node),
        ...(container ? { inside: formatNodeRef(graph.nodes, container) } : {}),
      }
    }),
    edges,
    triggerType: triggerType ?? null,
    ...(readOnlyNodes.length > 0 ? { readOnlyNodes } : {}),
  }
}

/** Friendly-render one node's resolved outputs (variable ids become `Title.path`). */
export function renderFriendlyOutputs(
  graph: DraftGraph,
  outputs: UnifiedVariable[],
  aliases?: ResourceAliasIndex
): UnifiedVariable[] {
  return renderPersistedRefs(structuredClone(outputs), {
    nodes: graph.nodes,
    resourceAliases: aliases,
  })
}

/**
 * Read the whole draft: graph + trigger + node summaries + resolved outputs +
 * current issues (`03` §1). The one-stop read a tool's `get_workflow` wraps.
 */
export async function readDraft(
  db: Database,
  params: GraphEditScope
): Promise<Result<DraftSummary, AuxxError>> {
  const loaded = await loadDraftContext(db, params)
  if (loaded.isErr()) return err(loaded.error)
  const ctx = loaded.value
  const aliases = await buildResourceAliasIndex(params.organizationId)

  const issues: Issue[] = [
    ...validateGraphStructure(ctx.graph, { lookup: ctx.lookup }),
    ...validateNodeConfigs(ctx.graph, ctx.lookup),
    ...validateBranchWiring(ctx.graph, ctx.lookup),
  ]

  const outputs: Record<string, UnifiedVariable[]> = {}
  const resolved = await resolveGraphOutputs(params.organizationId, { graph: ctx.graph })
  if (resolved.isOk()) {
    issues.push(
      ...checkVariableRefsAgainstOutputs({
        graph: ctx.graph,
        outputs: resolved.value,
        lookup: ctx.lookup,
      }).issues
    )
    for (const node of ctx.graph.nodes) {
      outputs[formatNodeRef(ctx.graph.nodes, node.id)] = renderFriendlyOutputs(
        ctx.graph,
        resolved.value.get(node.id) ?? [],
        aliases
      )
    }
  }

  return ok({
    workflowAppId: ctx.workflowAppId,
    name: ctx.appName,
    triggerType: ctx.triggerType,
    nodes: ctx.graph.nodes.map((node) => buildNodeSummary(ctx.graph, node, aliases, ctx.lookup)),
    edges: buildGraphSummary(ctx.graph, ctx.lookup, ctx.triggerType).edges,
    outputs,
    issues,
    graphSummary: buildGraphSummary(ctx.graph, ctx.lookup, ctx.triggerType),
  })
}

/** What {@link validateWorkflow} reports. */
export interface WorkflowValidationReport {
  /** The real publish gate's verdict (`WorkflowEngine.validateWorkflowForPublish`). */
  publishable: boolean
  publishErrors: string[]
  publishWarnings: string[]
  /** Structural + config + reference issues, same tiers every mutation returns. */
  issues: Issue[]
}

/**
 * Check publishability without publishing: runs the three validation tiers
 * plus the REAL publish gate over the current draft. Publishing itself stays
 * the user's action — this only reports.
 */
export async function validateWorkflow(
  db: Database,
  params: GraphEditScope
): Promise<Result<WorkflowValidationReport, AuxxError>> {
  const loaded = await loadDraftContext(db, params)
  if (loaded.isErr()) return err(loaded.error)
  const ctx = loaded.value

  const issues: Issue[] = [
    ...validateGraphStructure(ctx.graph, { lookup: ctx.lookup }),
    ...validateNodeConfigs(ctx.graph, ctx.lookup),
    ...validateBranchWiring(ctx.graph, ctx.lookup),
  ]
  const resolved = await resolveGraphOutputs(params.organizationId, { graph: ctx.graph })
  if (resolved.isOk()) {
    issues.push(
      ...checkVariableRefsAgainstOutputs({
        graph: ctx.graph,
        outputs: resolved.value,
        lookup: ctx.lookup,
      }).issues
    )
  }

  if (!ctx.draftRow) {
    return ok({
      publishable: false,
      publishErrors: ['No draft workflow to publish'],
      publishWarnings: [],
      issues,
    })
  }

  // Lazy import — `workflow-version-service` statically loads `WorkflowEngine`,
  // whose module graph must not ride along with every graph-edit read (same
  // rule as the engine's own dynamic loading; see
  // `project_workflow_engine_import_cycle`).
  const { validateDraftWorkflowForPublish } = await import('../workflow-version-service')
  const gate = await validateDraftWorkflowForPublish(ctx.draftRow)
  return ok({
    publishable: gate.valid,
    publishErrors: gate.errors,
    publishWarnings: gate.warnings ?? [],
    issues,
  })
}
