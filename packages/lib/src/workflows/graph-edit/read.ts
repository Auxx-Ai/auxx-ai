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
import { resolveGraphOutputs } from '../../workflow-engine/catalog/resolve-outputs'
import type { ManifestLookup } from '../../workflow-engine/catalog/types'
import type { UnifiedVariable } from '../../workflow-engine/types/unified-variable'
import { hashWorkflowGraph } from '../graph-hash'
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
import { nodeType, validateGraphStructure, validateNodeConfigs } from './validate'

/** Everything a mutation or read needs about the loaded draft. */
export interface DraftContext {
  workflowAppId: string
  organizationId: string
  appName: string
  appDescription: string | null
  /** The raw draft `Workflow` row (null when the app has no draft yet). */
  draftRow: Record<string, unknown> | null
  graph: DraftGraph
  /** CAS token — hash of the stored graph; undefined when there is none yet. */
  graphHash?: string
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

/** Normalize whatever the jsonb column holds into a well-formed graph doc. */
function toDraftGraph(raw: unknown): DraftGraph {
  const graph = (raw ?? {}) as Partial<DraftGraph>
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
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
  return ok({
    workflowAppId,
    organizationId,
    appName: app.name,
    appDescription: app.description,
    draftRow,
    graph: toDraftGraph(rawGraph),
    ...(rawGraph ? { graphHash: hashWorkflowGraph(rawGraph) } : {}),
    triggerType: (draftRow?.triggerType as string | null | undefined) ?? null,
    lookup: await buildManifestLookup(organizationId),
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
])

/** Hash durable node data only; derived keys are regenerated and stripped on save. */
export function hashNodeConfig(data: Record<string, unknown>): string {
  return hashWorkflowGraph(stripDerivedKeys(data))
}

/** One node's summary: friendly ref + friendly-rendered config. */
export function buildNodeSummary(
  graph: DraftGraph,
  node: GraphNode,
  aliases?: ResourceAliasIndex
): NodeSummary {
  const config: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((node.data ?? {}) as Record<string, unknown>)) {
    if (isDerivedKey(key) || NON_CONFIG_KEYS.has(key)) continue
    config[key] = value
  }
  const container = node.parentId ?? (node.data?.loopId as string | undefined)
  return {
    ref: formatNodeRef(graph.nodes, node.id),
    id: node.id,
    type: nodeType(node),
    title: typeof node.data?.title === 'string' ? node.data.title : '',
    configHash: hashNodeConfig((node.data ?? {}) as Record<string, unknown>),
    ...(container ? { inside: formatNodeRef(graph.nodes, container) } : {}),
    position: node.position ?? { x: 0, y: 0 },
    config: renderPersistedRefs(config, { nodes: graph.nodes, resourceAliases: aliases }),
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
    nodes: ctx.graph.nodes.map((node) => buildNodeSummary(ctx.graph, node, aliases)),
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
