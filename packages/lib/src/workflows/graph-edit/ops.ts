// packages/lib/src/workflows/graph-edit/ops.ts

/**
 * Graph mutations (`03-graph-edit-service.md` §1) — SERVER-ONLY writes.
 *
 * Every mutation runs the same pipeline: load draft → resolve refs →
 * normalize → apply → layout → validate → persist → return
 * `{ node, outputs, issues, graphSummary }`. Structural errors (and
 * unresolvable references) REJECT before persisting (`applied: false`);
 * config and reference issues PERSIST and come back as `issues` — a
 * half-built workflow is legitimate, mirroring the canvas.
 *
 * NO permission checks live here (house rule): callers must assert
 * `capabilities.assertEditInstance('workflow', workflowAppId)` and
 * `assertWorkflowAppNotSystemOwned` before calling in. `publish`/`enabled`
 * are never written by any of these operations.
 */

import type { Database } from '@auxx/database'
import { incrementTitle, nextKeyAfter } from '@auxx/utils'
import { generateId } from '@auxx/utils/generateId'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError, ConflictError, NotFoundError } from '../../errors'
import { LOOP_HANDLES } from '../../workflow-engine/catalog/nodes/loop'
import { getAuthorableManifests, getManifest } from '../../workflow-engine/catalog/registry'
import { resolveGraphOutputs } from '../../workflow-engine/catalog/resolve-outputs'
import { NodeCategory, type NodeManifest } from '../../workflow-engine/catalog/types'
import type { UnifiedVariable } from '../../workflow-engine/types/unified-variable'
import { assertMailTriggerNotPersonal } from '../mail-trigger-guard'
import { calculateContainerSize, getLayoutByDagre, getLayoutForChildNodes } from './layout'
import { LAYOUT_SPACING, NODE_ADDITION_CONFIG } from './layout-constants'
import { resolveConnectionSpec } from './normalize/connection'
import { normalizeFriendlyRefs, type ResourceAliasIndex } from './normalize/friendly-refs'
import { normalizeAiPromptConfig } from './normalize/prompt'
import { checkVariableRefsAgainstOutputs } from './normalize/ref-check'
import { buildResourceAliasIndex, normalizeResourceConfig } from './normalize/resource-refs'
import { applyConfigPatches, type ConfigPatch } from './patch-config'
import { persistDraft, publishDraftUpdatedSignal } from './persist'
import {
  DEFAULT_NODE_SIZE,
  findNearestEmptySpace,
  placeAfter,
  placeAsInput,
  placeInside,
  placeStandalone,
} from './place-node'
import {
  buildGraphSummary,
  buildNodeSummary,
  type DraftContext,
  type GraphEditScope,
  hashNodeConfig,
  loadDraftContext,
  renderFriendlyOutputs,
} from './read'
import { describeNode, formatNodeRef, resolveNodeRef } from './refs'
import { captureWorkflowTurnSnapshot } from './turn-snapshot'
import type { DraftGraph, GraphEdge, GraphMutationResult, GraphNode, Issue, Point } from './types'
import {
  INPUT_WIRING_HANDLES,
  isInputNodePair,
  isTriggerNode,
  nodeType,
  validateGraphStructure,
  validateNodeConfigs,
} from './validate'

/**
 * Scope every MUTATION takes — `GraphEditScope` plus the optional turn id.
 * With `turnId`, the pipeline captures the pre-edit graph before the turn's
 * first write (`turn-snapshot.ts`) so the turn lifecycle can revert on
 * failure; without it (non-turn callers: system paths, scripts) no snapshot
 * is taken and the write is plain.
 */
export interface GraphMutationScope extends GraphEditScope {
  turnId?: string
}

/** The plan a specific mutation hands the shared pipeline. */
interface MutationPlan {
  graph: DraftGraph
  /** The node the result's `node`/`outputs` describe. */
  touchedNodeId?: string
  /** Nodes this mutation introduced/retyped — scope of the authorable check. */
  newNodeIds?: ReadonlySet<string>
  /** Normalization findings; `error` severity blocks the persist. */
  normalizeIssues: Issue[]
  /** Curated graphs (templates) may carry non-authorable nodes — skip that check. */
  skipAuthorableCheck?: boolean
  /** Overrides `ctx.triggerType` as the fallback when the graph derives none. */
  fallbackTriggerType?: string | null
  envVars?: unknown[]
  variables?: unknown[]
  icon?: { iconId: string; color: string }
}

/**
 * The shared mutation pipeline. Blocking tiers (normalize errors, structural
 * errors, the mail-trigger guard) return `applied: false` with the original
 * graph untouched; everything else persists through the one seam
 * (`persistDraft`) and reports. The turn snapshot is captured immediately
 * before the persist (first write of a turn only) and the
 * `workflow:draft-updated` signal fires immediately after a successful one —
 * ALL the snapshot/realtime wiring lives here, not in the individual ops.
 */
async function runGraphMutation(
  db: Database,
  scope: GraphMutationScope,
  build: (
    ctx: DraftContext,
    aliases: ResourceAliasIndex
  ) => Promise<Result<MutationPlan, AuxxError>>
): Promise<Result<GraphMutationResult, AuxxError>> {
  const loaded = await loadDraftContext(db, scope)
  if (loaded.isErr()) return err(loaded.error)
  const ctx = loaded.value
  const aliases = await buildResourceAliasIndex(scope.organizationId)

  const planResult = await build(ctx, aliases)
  if (planResult.isErr()) return err(planResult.error)
  const plan = planResult.value
  const { graph } = plan

  const structural = validateGraphStructure(graph, {
    ...(plan.skipAuthorableCheck ? {} : { newNodeIds: plan.newNodeIds }),
  })
  const guardIssues: Issue[] = []
  const hasBlocking = () =>
    plan.normalizeIssues.some((i) => i.severity === 'error') ||
    structural.some((i) => i.severity === 'error') ||
    guardIssues.length > 0
  if (!hasBlocking()) {
    try {
      // The same blocking guard `WorkflowService.update` runs — checked here so
      // it reports as a structured issue instead of a bare throw.
      await assertMailTriggerNotPersonal(db, scope.organizationId, graph)
    } catch (error) {
      if (!(error instanceof AuxxError)) throw error
      guardIssues.push({ severity: 'error', message: error.message })
    }
  }

  if (hasBlocking()) {
    return ok({
      applied: false,
      issues: [...plan.normalizeIssues, ...structural, ...guardIssues],
      graphSummary: buildGraphSummary(ctx.graph, ctx.triggerType),
    })
  }

  const issues: Issue[] = [...plan.normalizeIssues, ...structural, ...validateNodeConfigs(graph)]
  let outputsMap: Map<string, UnifiedVariable[]> | undefined
  const resolved = await resolveGraphOutputs(scope.organizationId, { graph })
  if (resolved.isOk()) {
    outputsMap = resolved.value
    issues.push(...checkVariableRefsAgainstOutputs({ graph, outputs: outputsMap }).issues)
  }

  // Pre-turn snapshot — captured only now that the write is certain to be
  // attempted, so a rejected mutation never marks the turn as "wrote
  // something". Idempotent per turn: only the FIRST write captures.
  if (scope.turnId !== undefined) {
    await captureWorkflowTurnSnapshot(scope.workflowAppId, scope.turnId, {
      graph: ctx.graph,
      triggerType: ctx.triggerType,
      name: ctx.appName,
      description: ctx.appDescription,
    })
  }

  const persisted = await persistDraft(db, scope, {
    graph,
    ...(ctx.graphHash !== undefined ? { expectedGraphHash: ctx.graphHash } : {}),
    fallbackTriggerType:
      plan.fallbackTriggerType !== undefined ? plan.fallbackTriggerType : ctx.triggerType,
    ...(plan.envVars !== undefined ? { envVars: plan.envVars as never } : {}),
    ...(plan.variables !== undefined ? { variables: plan.variables as never } : {}),
    ...(plan.icon !== undefined ? { icon: plan.icon } : {}),
  })
  if (persisted.isErr()) {
    // Hash-CAS conflict (`07-remaining-mechanics.md` §6): a concurrent save
    // landed between load and write. Surface it typed and actionable — the
    // caller re-reads the draft and retries; never a silent overwrite, never
    // a generic 500.
    if (persisted.error instanceof ConflictError) {
      return err(
        new ConflictError(
          'The workflow draft changed while this edit was being prepared — another save ' +
            'landed first. Re-read the draft and retry the operation on the fresh graph. ' +
            'Nothing was overwritten.'
        )
      )
    }
    return err(persisted.error)
  }

  // Refresh signal AFTER the successful persist — open canvases refetch.
  await publishDraftUpdatedSignal(scope.organizationId, {
    workflowAppId: scope.workflowAppId,
    ...(plan.touchedNodeId || plan.newNodeIds?.size
      ? {
          nodeIds: [
            ...new Set([
              ...(plan.touchedNodeId ? [plan.touchedNodeId] : []),
              ...(plan.newNodeIds ?? []),
            ]),
          ],
        }
      : {}),
    reason: scope.turnId !== undefined ? 'kopilot' : 'system',
  })

  const touched = plan.touchedNodeId
    ? graph.nodes.find((n) => n.id === plan.touchedNodeId)
    : undefined
  return ok({
    applied: true,
    ...(touched ? { node: buildNodeSummary(graph, touched, aliases) } : {}),
    ...(touched && outputsMap
      ? { outputs: renderFriendlyOutputs(graph, outputsMap.get(touched.id) ?? [], aliases) }
      : {}),
    issues,
    graphSummary: buildGraphSummary(graph, persisted.value.triggerType ?? ctx.triggerType),
  })
}

/** Top-level prose keys the bare-ref rewriter must never touch — a title set
 * to another node's exact title is a NAME, not a reference. `{{…}}` spans
 * inside them still normalize (they re-enter via the span walk below). */
const PROSE_CONFIG_KEYS = ['title', 'desc', 'description'] as const

/** friendly refs → resource refs → prompt: the §3 normalization chain, in order. */
async function normalizeConfig(
  organizationId: string,
  nodes: GraphNode[],
  aliases: ResourceAliasIndex,
  type: string,
  config: Record<string, unknown>
): Promise<{ config: Record<string, unknown>; issues: Issue[] }> {
  const prose: Record<string, unknown> = {}
  const rest: Record<string, unknown> = { ...config }
  for (const key of PROSE_CONFIG_KEYS) {
    if (typeof rest[key] === 'string' && !(rest[key] as string).includes('{{')) {
      prose[key] = rest[key]
      delete rest[key]
    }
  }
  const friendly = normalizeFriendlyRefs(rest, { nodes, resourceAliases: aliases })
  const resource = await normalizeResourceConfig(organizationId, type, friendly.data)
  return {
    config: { ...normalizeAiPromptConfig(type, resource.config), ...prose },
    issues: [...friendly.issues, ...resource.issues],
  }
}

/** Manifest for an authorable type, or an actionable error naming the options. */
function requireAuthorableManifest(type: string): Result<NodeManifest<any>, AuxxError> {
  const manifest = getManifest(type)
  if (manifest?.agent?.authorable === true) return ok(manifest)
  const authorable = getAuthorableManifests()
    .map((m) => m.id)
    .sort()
    .join(', ')
  return err(
    new BadRequestError(
      `Node type "${type}" ${manifest ? 'cannot be authored here' : 'does not exist'}. ` +
        `Authorable types: ${authorable}.`
    )
  )
}

/** `${source}-${handle}-${target}-${targetHandle}` — the canvas EdgeManager's id format. */
function makeEdge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  data?: GraphEdge['data']
): GraphEdge {
  return {
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    ...(data ? { data } : {}),
  }
}

/**
 * Handles for a new edge. An input node attaching to a node that accepts
 * inputs uses the input-wiring pair (`input-output` → `input`); everything
 * else keeps today's behaviour — the resolved source/branch handle into
 * `target`. Loop-back edges never come through here (their handle IS the
 * thing that makes them loop-backs).
 *
 * Gated on the SAME `isInputNodePair` the validator judges existing graphs
 * with, so this can never mint an edge `validateGraphStructure` would reject.
 * Its strictness is what stops an app-block (permanently uncatalogued) being
 * wired onto a trigger's `input` handle — see its docblock.
 */
function resolveEdgeHandles(
  source: GraphNode | undefined,
  target: GraphNode,
  sourceHandle: string
): { sourceHandle: string; targetHandle: string } {
  if (source && isInputNodePair(source, target)) return { ...INPUT_WIRING_HANDLES }
  return { sourceHandle, targetHandle: 'target' }
}

/**
 * Canvas parity for `ManualNodeData.inputNodes` — the connected-input id list
 * the canvas maintains (`use-node-interactions.ts`) on any node whose
 * manifest sets `acceptsInputNodes`. Pure metadata: no output variable is
 * gated on it, so a drifted list is cosmetic, not a contract break.
 */
function updateInputNodes(
  nodes: GraphNode[],
  update: (current: string[]) => string[],
  opts: { onlyNodeId?: string } = {}
): GraphNode[] {
  return nodes.map((node) => {
    if (opts.onlyNodeId !== undefined && node.id !== opts.onlyNodeId) return node
    if (getManifest(nodeType(node))?.connection.acceptsInputNodes !== true) return node
    const current = Array.isArray(node.data?.inputNodes)
      ? (node.data.inputNodes as unknown[]).filter((id): id is string => typeof id === 'string')
      : []
    const next = update(current)
    if (next.length === current.length && next.every((id, i) => id === current[i])) return node
    return { ...node, data: { ...node.data, inputNodes: next } }
  })
}

/**
 * The nodes already wired into `targetId` on the input handle, in graph order.
 * Read off the EDGES rather than `data.inputNodes` — the edge is the contract
 * the validator and the engine both judge, the list is cosmetic parity.
 */
function wiredInputNodes(nodes: GraphNode[], edges: GraphEdge[], targetId: string): GraphNode[] {
  const sources = new Set(
    edges
      .filter(
        (e) =>
          e.target === targetId &&
          (e.targetHandle ?? 'target') === INPUT_WIRING_HANDLES.targetHandle
      )
      .map((e) => e.source)
  )
  return nodes.filter((n) => sources.has(n.id))
}

/**
 * The next run-form `position` for a field joining `existingInputs` — the
 * fractional index (`generateKeyBetween`) that orders fields on the manual
 * trigger's form, NOT a canvas coordinate. Without it every agent-created field
 * lands `position: undefined` and the connected-inputs editor sorts them
 * unstably (its comparator returns 0 for two undefineds).
 *
 * `nextKeyAfter` rather than the strict `generateKeyBetween`: a legacy or
 * hand-edited node can carry a corrupt key, and the strict call throws on one,
 * which would poison every later insert into the same form.
 */
function nextInputPosition(existingInputs: GraphNode[]): string {
  const positions = existingInputs
    .map((n) => n.data?.position)
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .sort((a, b) => a.localeCompare(b))
  return nextKeyAfter(positions.at(-1) ?? null)
}

/**
 * Whether a node type's config schema declares the run-form `position` key, so
 * only types that order themselves on a form get one assigned. Read off the
 * manifest's own schema — never a node-type string match.
 */
function declaresRunFormPosition(manifest: NodeManifest<any>): boolean {
  const shape = (manifest.configSchema as unknown as { shape?: Record<string, unknown> }).shape
  return typeof shape === 'object' && shape !== null && 'position' in shape
}

/** Fresh node data — NodeFactory parity (defaults under config, identity on top). */
function buildNodeData(
  manifest: NodeManifest<any>,
  nodeId: string,
  config: Record<string, unknown>,
  extras: { title: string; loopId?: string }
): Record<string, unknown> {
  return {
    id: nodeId,
    desc: manifest.description,
    isValid: true,
    errors: [],
    disabled: false,
    selected: false,
    ...(extras.loopId ? { isInLoop: true, loopId: extras.loopId } : {}),
    ...(manifest.defaultData() as Record<string, unknown>),
    ...config,
    type: manifest.id,
    title: extras.title,
  }
}

/** Unique title (case-sensitive, `incrementTitle` — the canvas's own nudge). */
function uniqueTitle(base: string, nodes: GraphNode[], excludeNodeId?: string): string {
  const existing = new Set(
    nodes
      .filter((n) => n.id !== excludeNodeId)
      .map((n) => (typeof n.data?.title === 'string' ? n.data.title : ''))
      .filter((t) => t.trim())
  )
  return incrementTitle(base, existing)
}

/** Grow a container so a new child fits — parity with `createResizedParentNode`. */
function resizeContainer(node: GraphNode, size: { width: number; height: number }): GraphNode {
  return {
    ...node,
    width: size.width,
    height: size.height,
    data: { ...node.data, width: size.width, height: size.height },
  }
}

/** Input for {@link addNode}. */
export interface AddNodeInput extends GraphMutationScope {
  /** Authorable node type (`data.type`), e.g. `'find'`. */
  type: string
  /** Friendly config — `{{Title.path}}` refs, resource slugs, plain prompts. */
  config?: Record<string, unknown>
  title?: string
  /** Predecessor to connect from (node title or id). */
  after?: string
  /** Branch of `after` to leave on (name or handle id) — via the manifest's branches. */
  branch?: string
  /** Loop container to place the node inside (title or id). */
  inside?: string
  /**
   * Node whose run form this node adds a field to (title or id) — the BACKWARDS
   * input wiring (`form-input --input-output--> manual --input`). Mutually
   * exclusive with `after`/`inside`: `after` connects FROM the anchor TO the new
   * node, which is the wrong direction for an input, and an input node is never
   * a loop child.
   */
  inputFor?: string
  /** Explicit canvas position — omitted, the §4 placement rules decide. */
  position?: Point
}

/**
 * Add one node. With `after`, the node lands one column right of its
 * predecessor (branch targets stack downward) and the connecting edge is
 * written on the branch handle resolved through
 * `manifest.connection.branches`. With `inside`, the node is contained in the
 * loop (top-level `parentId`, parent-relative position, loop-start edge for
 * the first child, container resized to fit). With `inputFor`, an INPUT-category
 * node attaches to a node that declares `acceptsInputNodes` — the edge runs
 * backwards on the input handles, the node lands in the target's input column
 * and gets the next run-form `position`. Existing nodes never move.
 */
export async function addNode(
  db: Database,
  params: AddNodeInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx, aliases) => {
    const manifestResult = requireAuthorableManifest(params.type)
    if (manifestResult.isErr()) return err(manifestResult.error)
    const manifest = manifestResult.value

    const { nodes, edges } = ctx.graph

    // Input wiring is its own attachment mode — the edge runs backwards, so
    // combining it with a forward `after` (or with loop containment) describes
    // no graph the canvas can draw.
    if (params.inputFor !== undefined && params.after !== undefined) {
      return err(
        new BadRequestError(
          '`inputFor` and `after` cannot be combined — `after` connects FROM a predecessor TO the ' +
            'new node, while `inputFor` attaches the new node BACKWARDS onto the run form of the ' +
            'node it names. Pick one.'
        )
      )
    }
    if (params.inputFor !== undefined && params.inside !== undefined) {
      return err(
        new BadRequestError(
          '`inputFor` and `inside` cannot be combined — an input node declares a field on a ' +
            "trigger's run form and is never a loop body node."
        )
      )
    }

    // Resolve the input-wiring target: it must DECLARE that it accepts inputs.
    // (The other half of the rule — that the node being added is an INPUT-
    // category type — is checked below, once the node exists, through the same
    // `isInputNodePair` the validator judges the persisted graph with.)
    let inputTarget: GraphNode | undefined
    if (params.inputFor !== undefined) {
      const resolved = resolveNodeRef(nodes, params.inputFor)
      if (resolved.isErr()) return err(resolved.error)
      inputTarget = resolved.value.node as GraphNode
      if (getManifest(nodeType(inputTarget))?.connection.acceptsInputNodes !== true) {
        const accepting = getAuthorableManifests()
          .filter((m) => m.connection.acceptsInputNodes === true)
          .map((m) => m.id)
          .sort()
          .join(', ')
        return err(
          new BadRequestError(
            `Node ${describeNode(inputTarget)} does not take input nodes — only a node with a run ` +
              `form does. Node types that accept inputs: ${accepting || 'none'}.`
          )
        )
      }
    }

    // Resolve containment and/or the predecessor connection.
    let parentId: string | undefined
    if (params.inside !== undefined) {
      const inside = resolveNodeRef(nodes, params.inside)
      if (inside.isErr()) return err(inside.error)
      if (nodeType(inside.value.node as GraphNode) !== 'loop') {
        return err(
          new BadRequestError(
            `Node ${describeNode(inside.value.node)} is not a loop — only loops contain other nodes.`
          )
        )
      }
      parentId = inside.value.node.id
    }

    let connection: { sourceNodeId: string; sourceHandle: string } | undefined
    if (params.after !== undefined) {
      const spec = resolveConnectionSpec(nodes, { after: params.after, branch: params.branch })
      if (spec.isErr()) return err(spec.error)
      connection = spec.value
      const anchor = nodes.find((n) => n.id === connection?.sourceNodeId)
      // Entering a loop through its loop-start handle IS containment; adding
      // after a loop child stays inside the same container.
      if (connection.sourceHandle === LOOP_HANDLES.LOOP_START) {
        parentId ??= connection.sourceNodeId
      } else {
        parentId ??=
          anchor?.parentId ??
          (typeof anchor?.data?.loopId === 'string' ? anchor.data.loopId : undefined)
      }
    }

    const normalized = await normalizeConfig(
      ctx.organizationId,
      nodes,
      aliases,
      params.type,
      params.config ?? {}
    )

    const nodeId = generateId(params.type)
    const baseTitle =
      params.title ??
      (typeof normalized.config.title === 'string' ? normalized.config.title : undefined) ??
      (typeof manifest.defaultData().title === 'string'
        ? (manifest.defaultData().title as string)
        : manifest.displayName)
    const title = uniqueTitle(baseTitle, nodes)

    // The fields already on the target's run form — both the placement stack
    // and the fractional `position` order are derived from them.
    const existingInputs = inputTarget
      ? wiredInputNodes(nodes as GraphNode[], edges, inputTarget.id)
      : []

    // §4 placement — existing nodes never move; only the new node is placed.
    const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined
    let position = params.position
    let resizedParent: GraphNode | undefined
    if (!position) {
      if (inputTarget) {
        position = placeAsInput(inputTarget, existingInputs)
      } else if (parent) {
        const children = nodes.filter((n) => n.parentId === parent.id)
        const anchor = connection ? nodes.find((n) => n.id === connection.sourceNodeId) : undefined
        if (anchor && anchor.id !== parent.id) {
          position = placeAfter(
            anchor as GraphNode,
            connection?.sourceHandle ?? 'source',
            children,
            edges
          )
        } else {
          const placement = placeInside(parent as GraphNode, children)
          position = placement.position
          if (placement.requiresResize && placement.suggestedSize) {
            resizedParent = resizeContainer(parent as GraphNode, placement.suggestedSize)
          }
        }
      } else if (connection) {
        const anchor = nodes.find((n) => n.id === connection.sourceNodeId)
        const topLevel = nodes.filter((n) => !n.parentId)
        position = anchor
          ? placeAfter(anchor as GraphNode, connection.sourceHandle, topLevel, edges)
          : placeStandalone(nodes)
      } else {
        position = placeStandalone(nodes)
      }
    }

    // Run-form order: the field joins the end of the target's form unless the
    // caller pinned a `position` itself.
    const runFormPosition =
      inputTarget && normalized.config.position === undefined && declaresRunFormPosition(manifest)
        ? { position: nextInputPosition(existingInputs) }
        : {}

    const newNode: GraphNode = {
      id: nodeId,
      type: params.type === 'note' ? 'note' : 'standard',
      position,
      ...(parentId ? { parentId, extent: 'parent' } : {}),
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
      selected: false,
      data: buildNodeData(
        manifest,
        nodeId,
        { ...normalized.config, ...runFormPosition },
        {
          title,
          ...(parentId ? { loopId: parentId } : {}),
        }
      ),
    }

    // The other half of the input-wiring rule, asked of the real node through
    // the one predicate `validateGraphStructure` uses — so this can never mint
    // an edge the validator would then reject.
    if (inputTarget && !isInputNodePair(newNode, inputTarget)) {
      const inputTypes = getAuthorableManifests()
        .filter((m) => m.category === NodeCategory.INPUT)
        .map((m) => m.id)
        .sort()
        .join(', ')
      return err(
        new BadRequestError(
          `Node type "${params.type}" is not an input node, so it cannot be attached to the run ` +
            `form of ${describeNode(inputTarget)}. Use \`inputFor\` only for input node types: ` +
            `${inputTypes || 'none'}. To connect "${params.type}" downstream of a node, use \`after\`.`
        )
      )
    }

    const newEdges: GraphEdge[] = []
    if (inputTarget) {
      const handles = resolveEdgeHandles(newNode, inputTarget, 'source')
      newEdges.push(makeEdge(nodeId, handles.sourceHandle, inputTarget.id, handles.targetHandle))
    } else if (connection) {
      newEdges.push(makeEdge(connection.sourceNodeId, connection.sourceHandle, nodeId, 'target'))
    } else if (parent && nodes.every((n) => n.parentId !== parent.id)) {
      // First child of a loop: the canvas wires loop-start → first body node.
      newEdges.push(makeEdge(parent.id, LOOP_HANDLES.LOOP_START, nodeId, 'target'))
    }

    let nextNodes = nodes.map((n) =>
      resizedParent && n.id === resizedParent.id ? resizedParent : n
    )
    if (inputTarget) {
      // Canvas parity: the target lists the input nodes wired into it.
      nextNodes = updateInputNodes(
        nextNodes as GraphNode[],
        (current) => (current.includes(nodeId) ? current : [...current, nodeId]),
        { onlyNodeId: inputTarget.id }
      )
    }
    return ok({
      graph: {
        nodes: [...nextNodes, newNode],
        edges: [...edges, ...newEdges],
        ...(ctx.graph.viewport ? { viewport: ctx.graph.viewport } : {}),
      },
      touchedNodeId: nodeId,
      newNodeIds: new Set([nodeId]),
      normalizeIssues: normalized.issues,
    })
  })
}

interface UpdateNodeBaseInput extends GraphMutationScope {
  /** Node title or id. */
  ref: string
}

/** Input for {@link updateNode}: a legacy shallow merge or guarded deep patches. */
export type UpdateNodeInput = UpdateNodeBaseInput &
  (
    | {
        /** Friendly config, shallow-merged over the node's current data. */
        config: Record<string, unknown>
        patches?: never
        expectedConfigHash?: never
      }
    | {
        /** Atomic edits against the complete friendly config returned by `get_node`. */
        patches: ConfigPatch[]
        /** `configHash` from the same `get_node` result used to choose the patch paths. */
        expectedConfigHash: string
        config?: never
      }
  )

/**
 * Update one node using either the legacy top-level merge or atomic, stale-safe
 * deep patches. `id`, `type`, and derived keys cannot be patched.
 */
export async function updateNode(
  db: Database,
  params: UpdateNodeInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx, aliases) => {
    const resolved = resolveNodeRef(ctx.graph.nodes, params.ref)
    if (resolved.isErr()) return err(resolved.error)
    const node = resolved.value.node as GraphNode
    const type = nodeType(node)
    const manifestResult = requireAuthorableManifest(type)
    if (manifestResult.isErr()) return err(manifestResult.error)

    let nextData: Record<string, unknown>
    let normalized: Awaited<ReturnType<typeof normalizeConfig>>

    if ('patches' in params) {
      const actualConfigHash = hashNodeConfig((node.data ?? {}) as Record<string, unknown>)
      if (params.expectedConfigHash !== actualConfigHash) {
        return err(
          new ConflictError(
            'This node changed after get_node returned it. Re-read the node and retry the ' +
              'patches with its new configHash. Nothing was overwritten.'
          )
        )
      }

      const currentFriendly = buildNodeSummary(ctx.graph, node, aliases).config
      const patched = applyConfigPatches(currentFriendly, params.patches)
      if (patched.isErr()) return err(patched.error)
      normalized = await normalizeConfig(
        ctx.organizationId,
        ctx.graph.nodes,
        aliases,
        type,
        patched.value
      )
      const { id: _id, type: _type, ...replacement } = normalized.config

      // Remove every previous agent-visible top-level key first. This makes an
      // `unset` durable while retaining identity, title, canvas, and derived data.
      nextData = { ...(node.data as Record<string, unknown>) }
      for (const key of Object.keys(currentFriendly)) delete nextData[key]
      nextData = { ...nextData, ...replacement }
    } else {
      normalized = await normalizeConfig(
        ctx.organizationId,
        ctx.graph.nodes,
        aliases,
        type,
        params.config
      )
      const { id: _id, type: _type, ...mergeable } = normalized.config
      nextData = { ...(node.data as Record<string, unknown>), ...mergeable }
    }

    const nextNodes = ctx.graph.nodes.map((n) => (n.id === node.id ? { ...n, data: nextData } : n))
    return ok({
      graph: { ...ctx.graph, nodes: nextNodes },
      touchedNodeId: node.id,
      newNodeIds: new Set([node.id]),
      normalizeIssues: normalized.issues,
    })
  })
}

/** Input for {@link deleteNodes}. */
export interface DeleteNodesInput extends GraphMutationScope {
  /** Node titles or ids. */
  refs: string[]
  /** Bridge each deleted node's incoming edges to its downstream targets. */
  reconnect?: boolean
}

/**
 * Delete nodes. Deleting a loop container deletes its children with it and
 * removes every touching edge — the canvas's own delete behaviour
 * (`use-node-interactions.ts` `handleDeleteNode` recurses into
 * `parentId`-children before removing the container; it never reparents).
 * With `reconnect`, each surviving predecessor is bridged to the deleted
 * span's surviving successors on the predecessor's own handle.
 */
export async function deleteNodes(
  db: Database,
  params: DeleteNodesInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx) => {
    if (params.refs.length === 0) return err(new BadRequestError('No node references given'))

    const { nodes, edges } = ctx.graph
    const toDelete = new Set<string>()
    for (const ref of params.refs) {
      const resolved = resolveNodeRef(nodes, ref)
      if (resolved.isErr()) return err(resolved.error)
      toDelete.add(resolved.value.node.id)
    }

    // Canvas parity: children go with their container (recursively, so a
    // nested loop's body is included too).
    let grew = true
    while (grew) {
      grew = false
      for (const node of nodes) {
        if (node.parentId && toDelete.has(node.parentId) && !toDelete.has(node.id)) {
          toDelete.add(node.id)
          grew = true
        }
      }
    }

    let bridged: GraphEdge[] = []
    if (params.reconnect) {
      // Successors reachable from a deleted node through deleted nodes only,
      // following forward (non-loop-back) edges.
      const survivingSuccessors = (start: string): string[] => {
        const found = new Set<string>()
        const stack = [start]
        const visited = new Set<string>()
        while (stack.length > 0) {
          const current = stack.pop()
          if (current === undefined || visited.has(current)) continue
          visited.add(current)
          for (const edge of edges) {
            if (edge.source !== current || edge.data?.isLoopBackEdge) continue
            if (toDelete.has(edge.target)) stack.push(edge.target)
            else found.add(edge.target)
          }
        }
        return [...found]
      }
      const seen = new Set<string>()
      for (const edge of edges) {
        if (edge.data?.isLoopBackEdge) continue
        if (toDelete.has(edge.source) || !toDelete.has(edge.target)) continue
        for (const target of survivingSuccessors(edge.target)) {
          const handle = edge.sourceHandle ?? 'source'
          const id = `${edge.source}-${handle}-${target}-target`
          if (seen.has(id) || edges.some((e) => e.id === id)) continue
          seen.add(id)
          bridged.push(makeEdge(edge.source, handle, target, 'target'))
        }
      }
      // Never bridge into a deleted node's container boundary handles.
      bridged = bridged.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target))
    }

    return ok({
      graph: {
        nodes: updateInputNodes(
          nodes.filter((n) => !toDelete.has(n.id)) as GraphNode[],
          (current) => current.filter((id) => !toDelete.has(id))
        ),
        edges: [
          ...edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target)),
          ...bridged,
        ],
        ...(ctx.graph.viewport ? { viewport: ctx.graph.viewport } : {}),
      },
      normalizeIssues: [],
    })
  })
}

/** Input for {@link connectNodes}. */
export interface ConnectNodesInput extends GraphMutationScope {
  from: string
  to: string
  /** Branch of `from` to leave on — resolved through the manifest's branches. */
  branch?: string
}

/**
 * Connect two nodes. The source handle is resolved through
 * `manifest.connection.branches(config)` — never string-matched. Connecting a
 * loop child back to its own container targets the `loop-back` handle and
 * flags the edge `isLoopBackEdge` (the initializer regenerates the flag from
 * `parentId` and the handle; both are written so the live graph matches).
 */
export async function connectNodes(
  db: Database,
  params: ConnectNodesInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx) => {
    const { nodes, edges } = ctx.graph
    const spec = resolveConnectionSpec(nodes, { after: params.from, branch: params.branch })
    if (spec.isErr()) return err(spec.error)
    const target = resolveNodeRef(nodes, params.to)
    if (target.isErr()) return err(target.error)

    const source = nodes.find((n) => n.id === spec.value.sourceNodeId)
    const targetNode = target.value.node as GraphNode
    const isLoopBack =
      nodeType(targetNode) === 'loop' &&
      (source?.parentId === targetNode.id || source?.data?.loopId === targetNode.id)

    const handles = resolveEdgeHandles(source, targetNode, spec.value.sourceHandle)
    const edge = isLoopBack
      ? makeEdge(spec.value.sourceNodeId, spec.value.sourceHandle, targetNode.id, 'loop-back', {
          isLoopBackEdge: true,
        })
      : makeEdge(spec.value.sourceNodeId, handles.sourceHandle, targetNode.id, handles.targetHandle)

    if (edges.some((e) => e.id === edge.id)) {
      return err(
        new BadRequestError(
          `${formatNodeRef(nodes, edge.source)} is already connected to ${formatNodeRef(nodes, edge.target)} on that branch.`
        )
      )
    }

    // Canvas parity: wiring an input node appends it to the target's list.
    const nextNodes =
      !isLoopBack && handles.targetHandle === INPUT_WIRING_HANDLES.targetHandle
        ? updateInputNodes(
            nodes as GraphNode[],
            (current) => (current.includes(edge.source) ? current : [...current, edge.source]),
            { onlyNodeId: targetNode.id }
          )
        : nodes

    return ok({
      graph: { ...ctx.graph, nodes: nextNodes, edges: [...edges, edge] },
      touchedNodeId: targetNode.id,
      normalizeIssues: [],
    })
  })
}

/** Input for {@link disconnectNodes}. */
export interface DisconnectNodesInput extends GraphMutationScope {
  from: string
  to: string
}

/** Remove every edge between two nodes (all branches). */
export async function disconnectNodes(
  db: Database,
  params: DisconnectNodesInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx) => {
    const { nodes, edges } = ctx.graph
    const from = resolveNodeRef(nodes, params.from)
    if (from.isErr()) return err(from.error)
    const to = resolveNodeRef(nodes, params.to)
    if (to.isErr()) return err(to.error)

    const sourceId = from.value.node.id
    const targetId = to.value.node.id
    const remaining = edges.filter((e) => !(e.source === sourceId && e.target === targetId))
    if (remaining.length === edges.length) {
      return err(
        new NotFoundError(
          `No connection from ${describeNode(from.value.node)} to ${describeNode(to.value.node)}.`
        )
      )
    }

    // Canvas parity: an input wiring that goes also leaves the target's list.
    const droppedInputWiring = edges.some(
      (e) =>
        e.source === sourceId &&
        e.target === targetId &&
        (e.targetHandle ?? 'target') === INPUT_WIRING_HANDLES.targetHandle
    )
    const nextNodes = droppedInputWiring
      ? updateInputNodes(
          nodes as GraphNode[],
          (current) => current.filter((id) => id !== sourceId),
          {
            onlyNodeId: targetId,
          }
        )
      : nodes

    return ok({
      graph: { ...ctx.graph, nodes: nextNodes, edges: remaining },
      normalizeIssues: [],
    })
  })
}

/** Input for {@link setTrigger}. */
export interface SetTriggerInput extends GraphMutationScope {
  /** In-graph trigger NODE type: manual, scheduled, resource-trigger, message-received. */
  triggerType: string
  /** Friendly trigger config (e.g. `{ operation: 'created', resourceType: 'ticket' }`). */
  config?: Record<string, unknown>
}

/**
 * Set the workflow's trigger — in-graph triggers only (D11; webhook endpoints
 * and app triggers stay manual). An existing trigger node is retyped IN PLACE
 * (same node id, same position, outgoing edges kept) so downstream
 * `{{Trigger.x}}` refs survive; with no trigger yet, one is created at the
 * left of the graph. The persist seam re-derives
 * `Workflow.triggerType`/`entityDefinitionId` from the new node.
 */
export async function setTrigger(
  db: Database,
  params: SetTriggerInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx, aliases) => {
    const manifestResult = requireAuthorableManifest(params.triggerType)
    if (manifestResult.isErr()) return err(manifestResult.error)
    const manifest = manifestResult.value
    if (!manifest.triggerType) {
      const triggerTypes = getAuthorableManifests()
        .filter((m) => m.triggerType)
        .map((m) => m.id)
        .sort()
        .join(', ')
      return err(
        new BadRequestError(
          `"${params.triggerType}" is not a trigger node type. In-graph triggers: ${triggerTypes}.`
        )
      )
    }

    const { nodes, edges } = ctx.graph
    const triggers = nodes.filter((n) => isTriggerNode(n as GraphNode))
    if (triggers.length > 1) {
      return err(
        new BadRequestError(
          `The workflow has ${triggers.length} trigger nodes (${triggers
            .map((t) => describeNode(t))
            .join(', ')}) — delete the extras first.`
        )
      )
    }

    const normalized = await normalizeConfig(
      ctx.organizationId,
      nodes,
      aliases,
      params.triggerType,
      params.config ?? {}
    )
    const baseTitle =
      (typeof normalized.config.title === 'string' ? normalized.config.title : undefined) ??
      (typeof manifest.defaultData().title === 'string'
        ? (manifest.defaultData().title as string)
        : manifest.displayName)

    const existing = triggers[0] as GraphNode | undefined
    if (existing) {
      const title = uniqueTitle(baseTitle, nodes as GraphNode[], existing.id)
      const nextNodes = nodes.map((n) =>
        n.id === existing.id
          ? {
              ...n,
              type: 'standard',
              data: buildNodeData(manifest, existing.id, normalized.config, { title }),
            }
          : n
      )
      return ok({
        graph: { ...ctx.graph, nodes: nextNodes },
        touchedNodeId: existing.id,
        newNodeIds: new Set([existing.id]),
        normalizeIssues: normalized.issues,
      })
    }

    const nodeId = generateId(params.triggerType)
    const title = uniqueTitle(baseTitle, nodes as GraphNode[])
    const topLevel = (nodes as GraphNode[]).filter((n) => !n.parentId)
    const preferred: Point =
      topLevel.length === 0
        ? { x: 250, y: 250 }
        : {
            x:
              Math.min(...topLevel.map((n) => n.position.x)) -
              LAYOUT_SPACING.DEFAULT_NODE_WIDTH -
              NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
            y: topLevel.reduce((sum, n) => sum + n.position.y, 0) / topLevel.length,
          }
    const newNode: GraphNode = {
      id: nodeId,
      type: 'standard',
      position: findNearestEmptySpace(preferred, DEFAULT_NODE_SIZE, topLevel, 'down'),
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
      selected: false,
      data: buildNodeData(manifest, nodeId, normalized.config, { title }),
    }
    return ok({
      graph: { ...ctx.graph, nodes: [...nodes, newNode], edges },
      touchedNodeId: nodeId,
      newNodeIds: new Set([nodeId]),
      normalizeIssues: normalized.issues,
    })
  })
}

/** One node of a {@link replaceGraph} spec. */
export interface ReplaceGraphNodeSpec {
  type: string
  title?: string
  config?: Record<string, unknown>
  position?: Point
  /** Title of the loop (among these specs) this node lives inside. */
  inside?: string
}

/** One edge of a {@link replaceGraph} spec — friendly refs by title. */
export interface ReplaceGraphEdgeSpec {
  from: string
  to: string
  branch?: string
}

/** Input for {@link replaceGraph}. */
export interface ReplaceGraphInput extends GraphMutationScope {
  nodes: ReplaceGraphNodeSpec[]
  edges: ReplaceGraphEdgeSpec[]
}

/**
 * Author a whole graph at once — RESTRICTED to EMPTY drafts. A model
 * re-emitting a graph it partially understands silently drops nodes, and a
 * full replace is exactly the operation nobody reviews, so a non-empty draft
 * is refused with instructions to edit incrementally (decision 2026-08-13).
 * Positions are auto-laid-out with the same dagre pass the canvas's
 * auto-organize uses; loop children are laid out inside their container.
 */
export async function replaceGraph(
  db: Database,
  params: ReplaceGraphInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx, aliases) => {
    if (ctx.graph.nodes.length > 0) {
      return err(
        new BadRequestError(
          `The draft already has ${ctx.graph.nodes.length} nodes — replaceGraph only builds onto ` +
            'an EMPTY draft. Edit incrementally instead (addNode / updateNode / connectNodes / ' +
            'deleteNodes), or delete the existing nodes explicitly first.'
        )
      )
    }
    if (params.nodes.length === 0) {
      return err(new BadRequestError('replaceGraph needs at least one node'))
    }

    // Pass 1 — mint ids and titles so refs in configs/edges can resolve.
    const built: GraphNode[] = []
    for (const spec of params.nodes) {
      const manifestResult = requireAuthorableManifest(spec.type)
      if (manifestResult.isErr()) return err(manifestResult.error)
      const manifest = manifestResult.value
      const nodeId = generateId(spec.type)
      const baseTitle =
        spec.title ??
        (typeof spec.config?.title === 'string' ? spec.config.title : undefined) ??
        (typeof manifest.defaultData().title === 'string'
          ? (manifest.defaultData().title as string)
          : manifest.displayName)
      const title = uniqueTitle(baseTitle, built)
      built.push({
        id: nodeId,
        type: spec.type === 'note' ? 'note' : 'standard',
        position: spec.position ?? { x: 0, y: 0 },
        width: DEFAULT_NODE_SIZE.width,
        height: DEFAULT_NODE_SIZE.height,
        selected: false,
        data: buildNodeData(manifest, nodeId, {}, { title }),
      })
    }

    // Pass 2 — containment, then normalized configs (refs resolve by title).
    const normalizeIssues: Issue[] = []
    for (let i = 0; i < params.nodes.length; i++) {
      const spec = params.nodes[i]
      const node = built[i]
      if (!spec || !node) continue
      if (spec.inside !== undefined) {
        const inside = resolveNodeRef(built, spec.inside)
        if (inside.isErr()) return err(inside.error)
        if (nodeType(inside.value.node as GraphNode) !== 'loop') {
          return err(
            new BadRequestError(`"${spec.inside}" is not a loop — only loops contain other nodes.`)
          )
        }
        node.parentId = inside.value.node.id
        node.extent = 'parent'
        node.data = { ...node.data, isInLoop: true, loopId: inside.value.node.id }
      }
      const manifest = getManifest(spec.type)
      if (!manifest) continue
      const normalized = await normalizeConfig(
        ctx.organizationId,
        built,
        aliases,
        spec.type,
        spec.config ?? {}
      )
      normalizeIssues.push(...normalized.issues)
      const { id: _id, type: _type, title: _title, ...config } = normalized.config
      node.data = { ...node.data, ...config }
    }

    // Pass 3 — edges through the branch resolver, loop-backs detected.
    const edges: GraphEdge[] = []
    for (const spec of params.edges) {
      const from = resolveConnectionSpec(built, { after: spec.from, branch: spec.branch })
      if (from.isErr()) return err(from.error)
      const to = resolveNodeRef(built, spec.to)
      if (to.isErr()) return err(to.error)
      const source = built.find((n) => n.id === from.value.sourceNodeId)
      const targetNode = to.value.node as GraphNode
      const isLoopBack = nodeType(targetNode) === 'loop' && source?.parentId === targetNode.id
      const handles = resolveEdgeHandles(source, targetNode, from.value.sourceHandle)
      const edge = isLoopBack
        ? makeEdge(from.value.sourceNodeId, from.value.sourceHandle, targetNode.id, 'loop-back', {
            isLoopBackEdge: true,
          })
        : makeEdge(
            from.value.sourceNodeId,
            handles.sourceHandle,
            targetNode.id,
            handles.targetHandle
          )
      if (!edges.some((e) => e.id === edge.id)) edges.push(edge)
      // Canvas parity: an input wiring is also listed on the target node.
      // `built` is mutated in place through the layout passes, so this writes
      // straight onto the node object rather than rebuilding the array.
      if (!isLoopBack && handles.targetHandle === INPUT_WIRING_HANDLES.targetHandle) {
        const [updated] = updateInputNodes([targetNode], (current) =>
          current.includes(edge.source) ? current : [...current, edge.source]
        )
        if (updated) targetNode.data = updated.data
      }
    }

    // Pass 4 — auto-layout: dagre for the top level (positions from centers,
    // the canvas auto-organize's math), per-container dagre for loop children,
    // containers sized to fit.
    const explicit = new Set(
      params.nodes.flatMap((spec, i) => (spec.position ? [built[i]?.id ?? ''] : []))
    )
    const layout = getLayoutByDagre(built, edges)
    for (const node of built) {
      if (node.parentId || explicit.has(node.id)) continue
      const placed = layout.node(node.id)
      if (!placed) continue
      node.position = {
        x: placed.x - (node.width || DEFAULT_NODE_SIZE.width) / 2,
        y: placed.y - (node.height || DEFAULT_NODE_SIZE.height) / 2,
      }
    }
    for (const container of built.filter((n) => built.some((c) => c.parentId === n.id))) {
      const childLayout = getLayoutForChildNodes(container.id, built, edges)
      const containerPadding = 20
      for (const child of built) {
        if (child.parentId !== container.id || explicit.has(child.id)) continue
        const placed = childLayout.node(child.id)
        if (!placed) continue
        child.position = {
          x: containerPadding + placed.x - (child.width || DEFAULT_NODE_SIZE.width) / 2,
          y: containerPadding + placed.y - (child.height || DEFAULT_NODE_SIZE.height) / 2,
        }
      }
      const size = calculateContainerSize(container.id, built, childLayout)
      container.width = Math.max(size.width, container.width || 0)
      container.height = Math.max(size.height, container.height || 0)
      container.data = { ...container.data, width: container.width, height: container.height }
    }

    return ok({
      graph: { nodes: built, edges, viewport: { x: 0, y: 0, zoom: 1 } },
      newNodeIds: new Set(built.map((n) => n.id)),
      normalizeIssues,
    })
  })
}

/** Input for {@link applyTemplate}. */
export interface ApplyTemplateInput extends GraphMutationScope {
  /** File template id (`file:<slug>`) or DB template row id. */
  templateId: string
  /** Stamped onto cloned graph metadata by the template transformer. */
  userId: string
}

/**
 * Install a template into an EMPTY draft, through the same
 * create-from-template path the router uses (`resolveTemplateById` +
 * `buildTemplateWorkflowData`): fresh node ids, `{{oldId.x}}` refs rewritten,
 * app slugs and `@entity:`/`@field:` refs resolved against this org, trigger
 * columns derived from the resolved graph. Curated templates may contain
 * non-authorable node types — those install as-is and stay read-only to the
 * agent.
 */
export async function applyTemplate(
  db: Database,
  params: ApplyTemplateInput
): Promise<Result<GraphMutationResult, AuxxError>> {
  return runGraphMutation(db, params, async (ctx) => {
    if (ctx.graph.nodes.length > 0) {
      return err(
        new BadRequestError(
          `The draft already has ${ctx.graph.nodes.length} nodes — applyTemplate only installs ` +
            'into an EMPTY draft. Delete the existing nodes first, or build on them incrementally.'
        )
      )
    }

    // Lazy imports — the template resolver pulls @auxx/services and the
    // transformer chain; neither belongs in this module's import-time graph.
    const { resolveTemplateById } = await import('../resolve-template')
    const { buildTemplateWorkflowData } = await import('../create-from-template')

    const template = await resolveTemplateById(params.templateId)
    if (!template) return err(new NotFoundError('Template not found'))

    const data = await buildTemplateWorkflowData(
      params.organizationId,
      params.userId,
      // Same cast the create-from-template router applies (workflow.ts:379) —
      // the template row's jsonb fields are looser than TemplateForCreate.
      template as import('../create-from-template').TemplateForCreate,
      false
    )
    const graph = data.graph as unknown as Partial<DraftGraph> | undefined
    return ok({
      graph: {
        nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
        edges: Array.isArray(graph?.edges) ? graph.edges : [],
        viewport: graph?.viewport ?? { x: 0, y: 0, zoom: 1 },
      },
      // Curated graphs may carry not-yet-migrated types (webhook templates).
      skipAuthorableCheck: true,
      normalizeIssues: [],
      fallbackTriggerType: data.triggerType ?? null,
      ...(data.envVars !== undefined ? { envVars: data.envVars as unknown[] } : {}),
      ...(data.variables !== undefined ? { variables: data.variables as unknown[] } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
    })
  })
}
