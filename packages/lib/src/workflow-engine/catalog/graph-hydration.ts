// packages/lib/src/workflow-engine/catalog/graph-hydration.ts

/**
 * The ONE definition of what a stored workflow graph document contains, and
 * what is rebuilt at the read boundary — `plans/kopilot/workflow/
 * 23-graph-document-canonicalization.md` §1, and `22-draft-save-discipline.md`
 * §2 R4.
 *
 * ```
 * hydrateGraph(graph)    // canonical stored shape → full working shape
 * dehydrateGraph(graph)  // canvas/agent shape    → canonical stored shape
 * ```
 *
 * **PURE and CLIENT-SAFE.** No `node:crypto`, no database, no org cache, no
 * React Flow. It may be imported from the browser bundle, from the engine, from
 * `graph-edit`, and from a data-migration script alike — which is the point:
 * today the canvas (`workflow-initializer.ts`), the engine
 * (`workflow-graph-builder.ts`) and `graph-edit` each hold their own opinion
 * about what a loop-back edge is.
 *
 * ## The contract
 *
 * `dehydrateGraph` is the **exact inverse** of `hydrateGraph` over the derived
 * half: for a graph already in canonical form,
 * `dehydrateGraph(hydrateGraph(g))` deep-equals `g`. That is not a nicety —
 * `graph-edit/ops.ts:288` short-circuits a no-op agent mutation by asserting
 * `hashWorkflowGraph(cleanGraphForSave(graph)) === ctx.graphHash`, i.e. "what I
 * would write equals what is stored". Break the inverse and that comparison
 * stops firing, which revives the repeated-`update_node` agent edit loop #1701
 * fixed. `graph-hydration.test.ts` pins it.
 *
 * Both functions are pure: the input graph is never mutated, and both are
 * idempotent (Kopilot turn snapshots round-trip a hydrated graph back through
 * `persistDraft`, so a snapshot captured before a deploy is restored after it).
 *
 * ## What this file does NOT do
 *
 * - **Containment.** `node.data.parentId` is never derived or written here.
 *   Top-level `node.parentId` is an *input* to hydration and is never
 *   stripped. Making the engine read containment is a change to the engine's
 *   own `WorkflowNode` type (plan 22 §8.3) — putting `parentId` inside
 *   `node.data` leaks it into the app-block input scrape, into Kopilot's
 *   writable config surface, and past `hashGraphSemantics`.
 * - **React-Flow-only derivations.** `_connectedSourceHandleIds`,
 *   `_connectedTargetHandleIds`, `_targetBranches` and `_children` stay in
 *   `apps/web`'s `initializeWorkflow`: two of them are computed with
 *   `@xyflow/react`'s `getConnectedEdges`, and the branch list is rendered
 *   through web's `branchNameCorrect`. They are already `_`-prefixed, so
 *   `dehydrateGraph` strips them either way.
 * - **Renaming any derived field to `_`.** Three of them are read
 *   server-side — `edge.data.isLoopBackEdge` by `catalog/graph-vars.ts:43`,
 *   `graph-edit/validate.ts:132`, `ops.ts:1126,1135`, `read.ts:187`, and
 *   `node.data.loopId` by `read.ts:162,206`, `ops.ts:782`,
 *   `graph-vars.ts:46`. A rename strips them at save and leaves those readers
 *   seeing `undefined` with no error. Hydration keeps the field where it is
 *   read; a rename would be a silent break.
 */

import { DEFAULT_SOURCE_HANDLE, DEFAULT_TARGET_HANDLE } from './graph-vars'

/** `data.type` of the container node whose children carry loop context. */
const LOOP_TYPE = 'loop'

/** `data.type` of the annotation node React Flow renders with its own component. */
const NOTE_TYPE = 'note'

/** The React Flow node component a hydrated node renders with — `{standard, note}`. */
const STANDARD_TYPE = 'standard'

/** The loop container's closing target handle (`nodes/core/loop/constants.ts`). */
const LOOP_BACK_HANDLE = 'loop-back'

/**
 * A stored graph node, structurally. Deliberately open (`[key: string]`):
 * `GraphNode` (`graph-edit/types.ts`), React Flow's `FlowNode` and a raw
 * `Workflow.graph` row all satisfy it, and this module must never import from
 * `workflows/` (the catalog is the lower tier).
 */
export interface GraphNodeDocument {
  id: string
  /** React Flow component key — DERIVED from `data.type`. */
  type?: string
  position?: { x: number; y: number }
  /** Containment. An INPUT to hydration; never stripped. */
  parentId?: string
  /** DERIVED: `'parent'` iff `parentId` is set. */
  extent?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

/** A stored graph edge, structurally. Same openness rationale as {@link GraphNodeDocument}. */
export interface GraphEdgeDocument {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  /** DERIVED by `calculateZIndex`. */
  zIndex?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

/** The `Workflow.graph` / `WorkflowRun.graph` / `WorkflowTemplate.graph` document. */
export interface GraphDocument {
  nodes: GraphNodeDocument[]
  edges: GraphEdgeDocument[]
  /**
   * The AUTHORED starting view (plan 23 §7, decided 2026-08-19). NOT derived
   * and NOT stripped — the per-user camera lives in `localStorage`.
   */
  viewport?: { x: number; y: number; zoom: number }
  [key: string]: unknown
}

/**
 * Options for {@link hydrateGraph}.
 *
 * Empty on purpose. This carried a `manifests` lookup and a `skipDefaults`
 * switch for a read-time `defaultData()` projection that was built, never
 * enabled, and is now deleted — see `hydration-policy.ts` for why the premise
 * was false. The interface stays so the signature does not churn if hydration
 * ever needs a real option.
 */
// biome-ignore lint/suspicious/noEmptyInterface: named seam, see the doc above
export interface HydrateGraphOptions {}

/** Options for {@link dehydrateGraph}. */
export interface DehydrateGraphOptions {
  /**
   * Drop `sourceHandle === 'source'` / `targetHandle === 'target'`, since
   * hydration restores them.
   *
   * **The FUNCTION default stays `false`; `DEHYDRATION_OPTIONS` turns it ON.**
   * That asymmetry is deliberate: a data migration doing read-modify-write must
   * keep seeing the stored bytes (`data-migrations/migrations/083-*.ts:17` says
   * so in its own header), so byte-preservation is what you get by omission and
   * the strip is what you get by opting into the shared policy.
   *
   * Plan `23` originally blocked this on `core/loop-execution-manager.ts:398`,
   * which resolves the next node inside a loop body with a strict
   * `edge.sourceHandle === outputHandle` and no `?? 'source'` on the edge side.
   * That comparison is safe, and always was: it filters
   * `currentWorkflow.graph.edges`, which is `built.workflow.graph.edges`
   * (`workflow-engine.ts:182`), which is `processedEdges` derived from
   * `hydrateGraph`'s output at `workflow-graph-builder.ts:160`. Handles are
   * filled before any routing runs. The independent proof is that
   * sequence-compiled graphs have never written `sourceHandle` at all and 870
   * such nodes execute in production.
   *
   * Two tests hold that up, and both must keep passing:
   * `core/__tests__/loop-handle-stripping.test.ts` walks a three-node loop body
   * whose stored edges carry no handles (it fails if the hydration boundary is
   * removed), and the parity suite's default-handle census fails if any new
   * strict comparison appears in the engine core.
   *
   * Non-default handles are CONTENT and are never stripped at any flag
   * setting: if-else `case_id`s, text-classifier category ids, `loop-start`,
   * `loop-back`, `approved`/`denied`/`timeout`, `fail`, `input`,
   * `input-output` (`parity/builder-rendered-handles.ts:53-167` is the
   * authoritative vocabulary). 64 of 130 bundled-template edges carry one;
   * stripping unconditionally would destroy every branch route in the fleet.
   */
  stripDefaultHandles?: boolean
}

/**
 * Node-object keys React Flow owns and rebuilds on mount. Never authored,
 * never read by the engine — but persisted today, which is why a click or a
 * mid-drag autosave is a byte-level change to the document (plan 22 §1.2).
 *
 * `width`/`height` are deliberately ABSENT: `handleNodeResize` writes an
 * authored size for container nodes, so they stay persisted.
 */
const EPHEMERAL_OBJECT_KEYS = [
  'selected',
  'dragging',
  'resizing',
  'selectable',
  'focusable',
  'deletable',
  'draggable',
  'measured',
  'positionAbsolute',
] as const

/**
 * `node.data` keys that are stripped and **not** re-derived (plan 23 §1.2).
 *
 * - `isValid` / `errors` have never held information: both writers hardcode
 *   `true` / `[]`, nothing updates them, and the live indicator re-runs the
 *   validator on a debounce instead of reading stored state.
 * - `selected` duplicates the top-level React Flow prop, which shadows it in
 *   every node component — and disagrees with it on 6 of the 29 nodes that
 *   carry both. Strip the inner one; do not "reconcile" them.
 * - `outputVariables` is legacy residue (6 nodes, all `[]`).
 */
const DEAD_NODE_DATA_KEYS = ['isValid', 'errors', 'selected', 'outputVariables'] as const

/**
 * Template-authoring aid that leaked into live documents.
 * `TemplateGraphTransformer.cloneGraph:59` strips it from `node.data` but not
 * from the node/edge object — 22 nodes + 31 edges in one workflow.
 */
const COMMENT_KEY = '$comment'

/** `node.data` keys hydration owns: it re-derives them, or deletes them. */
const DERIVED_NODE_DATA_KEYS = ['id', 'isInLoop', 'loopId'] as const

/**
 * `edge.data` keys hydration owns.
 *
 * **Scoped to `edge.data` on purpose.** `node.data.sourceType` is AUTHORED
 * config on `document-extractor` (`catalog/nodes/document-extractor.ts:57,88,
 * 107,127,187`) — a name collision, not the same field.
 */
const DERIVED_EDGE_DATA_KEYS = [
  'sourceType',
  'targetType',
  'isInLoop',
  'loopId',
  'isLoopBackEdge',
] as const

/**
 * A stored row is not guaranteed to have both arrays: hydration sits at read
 * boundaries the engine and the builder both go through, and §4 is explicit
 * that a missed/malformed reader must degrade, never throw. A graph with no
 * `edges` key is a legitimate legacy shape.
 */
function nodesOf(graph: GraphDocument): GraphNodeDocument[] {
  return Array.isArray(graph.nodes) ? graph.nodes : []
}

/** See {@link nodesOf}. */
function edgesOf(graph: GraphDocument): GraphEdgeDocument[] {
  return Array.isArray(graph.edges) ? graph.edges : []
}

/** Derived (canvas-owned, never-persisted) keys are `_`-prefixed. */
function isDerivedKey(key: string): boolean {
  return key.startsWith('_')
}

/** `node.data.type` when present, else the React Flow `node.type`. Every engine reader's rule. */
function effectiveNodeType(node: GraphNodeDocument): string {
  const dataType = node.data?.type
  if (typeof dataType === 'string' && dataType.length > 0) return dataType
  return typeof node.type === 'string' ? node.type : ''
}

/**
 * Legacy app trigger nodes stored `data.type: 'app-trigger'` before the
 * `appId:triggerId` keyspace existed. Ported verbatim from
 * `workflow-initializer.ts normalizeLegacyNodes`.
 *
 * This is the ONE place hydration rewrites authored content rather than
 * derived state, so `dehydrateGraph(hydrateGraph(g))` is not the identity for
 * such a node — the write seam persists the migrated type. Self-healing and
 * deliberate: the alternative is a node whose type nothing can resolve.
 */
function normalizeLegacyAppTrigger(node: GraphNodeDocument): GraphNodeDocument {
  const data = node.data
  if (!data || data.type !== 'app-trigger') return node
  const { appId, triggerId } = data
  if (typeof appId !== 'string' || typeof triggerId !== 'string') return node
  return { ...node, data: { ...data, type: `${appId}:${triggerId}` } }
}

/**
 * `calculateZIndex` (`apps/web/.../utils/edge-utils.ts`), ported verbatim:
 * the larger of the two endpoints' `zIndex`, defaulting to 0. Stored nodes
 * carry no `zIndex`, so in practice every hydrated edge gets `0` — which is
 * exactly what the canvas computes today.
 */
function calculateZIndex(
  edge: GraphEdgeDocument,
  nodesById: Map<string, GraphNodeDocument>
): number {
  const sourceZ = nodesById.get(edge.source)?.zIndex
  const targetZ = nodesById.get(edge.target)?.zIndex
  return Math.max(
    typeof sourceZ === 'number' ? sourceZ : 0,
    typeof targetZ === 'number' ? targetZ : 0
  )
}

/**
 * Canonical stored shape → full working shape. Call at EVERY read boundary
 * where a stored graph becomes a working graph (plan 23 §4.2 enumerates them).
 *
 * Pure, idempotent, and — against a document today's builder wrote — a no-op,
 * which is what makes the read-side rollout provably behaviour-neutral.
 *
 * What it derives:
 *
 * | field | from |
 * |---|---|
 * | `node.type` (`'standard'`/`'note'`) | `data.type` |
 * | `node.extent` (`'parent'`) | `parentId` presence |
 * | `node.data.id` | `node.id` |
 * | `node.data.type` | `node.type`, when `data.type` is absent |
 * | `node.data.isInLoop` / `loopId` | top-level `parentId` + the parent's type |
 * | `edge.data.sourceType` / `targetType` | the endpoint nodes' `data.type` |
 * | `edge.data.isInLoop` / `loopId` | both endpoints in the SAME loop |
 * | `edge.data.isLoopBackEdge` | `targetHandle === 'loop-back'` ∨ source parented in the target loop |
 * | `edge.zIndex` | `calculateZIndex` |
 * | `edge.sourceHandle` / `targetHandle` | the defaults, when absent |
 *
 * **Hydration is AUTHORITATIVE over that set**: a stale stored value it cannot
 * re-derive is *deleted*, not preserved. That is what makes `dehydrateGraph`
 * an exact inverse. It is the one behavioural difference from
 * `initializeWorkflow`, which only ever set these keys.
 *
 * **The 870-row surprise, so nobody reads it as a bug.** 870 sequence-compiled
 * nodes store real engine types (`wait`, `sequence-send-email`, `end`,
 * `manual`) at `node.type`. Hydration rewrites all of them to `'standard'`.
 * Verified inert: all 870 also carry a matching `data.type`, every engine
 * reader is `data.type || node.type`, and `initializeWorkflow` already does
 * exactly this in memory. A round-trip check over dev WILL show 870 rows
 * changing.
 *
 * @param graph a stored (or already-hydrated) graph document
 * @param options see {@link HydrateGraphOptions} — currently empty
 * @returns a new graph — the input is never mutated
 */
export function hydrateGraph<G extends GraphDocument>(
  graph: G,
  options: HydrateGraphOptions = {}
): G {
  const normalized = nodesOf(graph).map(normalizeLegacyAppTrigger)

  // Which containers are loops — read from `data.type`, the same rule
  // `computeLoopAncestry` uses. (`graph-vars.ts:40 getForwardEdges` still
  // asks `n.type === 'loop'`, which is false for every canvas graph both
  // before and after hydration; `isLoopBackEdge` is what carries the filter.
  // Reconciling that reader is plan 23 §7, not this function's job.)
  const loopNodeIds = new Set(
    normalized.filter((node) => effectiveNodeType(node) === LOOP_TYPE).map((node) => node.id)
  )

  const nodes = normalized.map((node) => {
    const data: Record<string, unknown> = { ...(node.data ?? {}) }

    // `data.type` first: the publish gate (`toEngineFormat`) reads it with NO
    // `node.type` fallback, so a node that only carries the React Flow type
    // must not lose it when dehydration strips `node.type`.
    if (typeof data.type !== 'string' && typeof node.type === 'string' && node.type.length > 0) {
      data.type = node.type
    }
    const type = effectiveNodeType(node)

    // Stored data is the whole of a node's content — nothing is layered under
    // it. Everything below this line is a DERIVATION the canvas and the engine
    // would otherwise each recompute for themselves.
    const content: Record<string, unknown> = data

    content.id = node.id
    if (type.length > 0) content.type = type

    const loopId =
      node.parentId !== undefined && loopNodeIds.has(node.parentId) ? node.parentId : undefined
    if (loopId !== undefined) {
      content.isInLoop = true
      content.loopId = loopId
    } else {
      delete content.isInLoop
      delete content.loopId
    }

    const hydrated: GraphNodeDocument = { ...node, data: content }
    // Only when a type is actually known. A node carrying no type at either
    // level must not acquire one here — inventing `'standard'` would make
    // `dehydrate ∘ hydrate` unstable, since the next dehydration has no
    // `data.type` to recover it from and would keep the invented value.
    if (type.length > 0) hydrated.type = type === NOTE_TYPE ? NOTE_TYPE : STANDARD_TYPE

    // `initializeWorkflow` does NOT rebuild this today, which is why a loop
    // child can be dragged out of its container after a reload: React Flow
    // clamps a child to its parent only when `extent === 'parent'`.
    if (node.parentId !== undefined) hydrated.extent = 'parent'
    else delete hydrated.extent

    return hydrated
  })

  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  const edges = edgesOf(graph).map((edge) => {
    const data: Record<string, unknown> = { ...(edge.data ?? {}) }

    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)

    if (source) data.sourceType = effectiveNodeType(source)
    else delete data.sourceType
    if (target) data.targetType = effectiveNodeType(target)
    else delete data.targetType

    const sourceLoopId = source?.data?.loopId
    const targetLoopId = target?.data?.loopId
    if (sourceLoopId !== undefined && sourceLoopId === targetLoopId) {
      data.isInLoop = true
      data.loopId = sourceLoopId
    } else {
      delete data.isInLoop
      delete data.loopId
    }

    // Both shapes of a loop-back edge, as `initializeWorkflow` matches them:
    // the live-draw predicate (wired to the container's `loop-back` handle)
    // AND the containment shape (source parented inside the target loop). An
    // edge on the `loop-back` handle whose source lacks `parentId` must still
    // be recognized, or `graph-vars.ts` stops filtering it and upstream
    // variable traversal sees a cycle.
    if (
      target !== undefined &&
      effectiveNodeType(target) === LOOP_TYPE &&
      (source?.parentId === target.id || edge.targetHandle === LOOP_BACK_HANDLE)
    ) {
      data.isLoopBackEdge = true
    } else {
      delete data.isLoopBackEdge
    }

    const hydrated: GraphEdgeDocument = {
      ...edge,
      sourceHandle: edge.sourceHandle ?? DEFAULT_SOURCE_HANDLE,
      targetHandle: edge.targetHandle ?? DEFAULT_TARGET_HANDLE,
      zIndex: calculateZIndex(edge, nodesById),
    }
    if (Object.keys(data).length > 0) hydrated.data = data
    else delete hydrated.data

    return hydrated
  })

  return { ...graph, nodes, edges } as G
}

/** Strip `_`-prefixed keys and `$comment` from one object level. Returns a copy. */
function stripLevel(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !isDerivedKey(key) && key !== COMMENT_KEY)
  )
}

/**
 * Canvas/agent shape → canonical stored shape. The ONE cleanup every write
 * seam runs: the builder's save owner, `graph-edit/persist.ts`'s
 * `cleanGraphForSave`, and `TemplateGraphTransformer` — the third door, which
 * cleans nothing today and is why 34 stored nodes carry `_targetBranches`
 * baked in from a bundled template.
 *
 * The stored document holds **authored content only**. Everything
 * {@link hydrateGraph} re-derives is removed, plus the strip-and-do-NOT-
 * re-derive set (§1.2) and React Flow's interaction state.
 *
 * **The invariant the current strip misses (§3.1).** `stripDerivedKeys` is
 * applied to `node.data` and `edge.data` and *nowhere else*, so a `_`-prefixed
 * key on the node or edge **object** persists forever — `edge._waitingRun` is
 * in 16 stored edges, including two published `WorkflowVersion` rows. This
 * function owns the `_` rule at every level of the document: the graph object,
 * each node and edge object, and each `data` object.
 *
 * The strip is LEVEL-SCOPED, not a deep scrub: it never descends into an
 * authored config value, because an HTTP node's `bodyJson` may legitimately
 * contain `{"_id": …}` and that is the user's payload, not our bookkeeping.
 *
 * What it deliberately KEEPS:
 * - top-level `node.parentId` — the input every containment derivation reads;
 * - `width` / `height` — `handleNodeResize` writes an authored container size;
 * - `node.data.position` on `form-input` — NOT a coordinate, it is the
 *   fractional run-form ordering key (`"a0"`, `"a1"`) minted by
 *   `ops.ts nextInputPosition`. Nothing here strips `position` from `data`;
 * - `node.data.desc` and `node.data.collapsed` — authored content and a real
 *   per-node user toggle;
 * - `node.data.sourceType` — authored config on `document-extractor`. Only
 *   `edge.data.sourceType` is derived;
 * - `graph.viewport` — the authored starting view (§7);
 * - non-default handles — every branch id, `case_id` and category id.
 *
 * @param graph a working (hydrated) or agent-authored graph document
 * @param options see {@link DehydrateGraphOptions} — note `stripDefaultHandles` defaults OFF
 * @returns a new graph — the input is never mutated
 */
export function dehydrateGraph<G extends GraphDocument>(
  graph: G,
  options: DehydrateGraphOptions = {}
): G {
  const nodes = nodesOf(graph).map((node) => {
    const type = effectiveNodeType(node)
    const data = stripLevel({ ...(node.data ?? {}) })

    for (const key of DERIVED_NODE_DATA_KEYS) delete data[key]
    for (const key of DEAD_NODE_DATA_KEYS) delete data[key]

    const stored = stripLevel(node) as GraphNodeDocument
    for (const key of EPHEMERAL_OBJECT_KEYS) delete stored[key]
    delete stored.extent

    // `node.type` is only recoverable from `data.type`. A sequence-compiled row
    // that somehow lacks `data.type` keeps its stored type rather than losing
    // it — dropping an unrecoverable type would be data loss, not cleanup.
    if (typeof data.type === 'string' && data.type.length > 0) delete stored.type

    if (Object.keys(data).length > 0) stored.data = data
    else delete stored.data

    return stored
  })

  const edges = edgesOf(graph).map((edge) => {
    const data = stripLevel({ ...(edge.data ?? {}) })
    for (const key of DERIVED_EDGE_DATA_KEYS) delete data[key]

    const stored = stripLevel(edge) as GraphEdgeDocument
    for (const key of EPHEMERAL_OBJECT_KEYS) delete stored[key]
    delete stored.zIndex

    if (options.stripDefaultHandles === true) {
      if (stored.sourceHandle === DEFAULT_SOURCE_HANDLE) delete stored.sourceHandle
      if (stored.targetHandle === DEFAULT_TARGET_HANDLE) delete stored.targetHandle
    }

    if (Object.keys(data).length > 0) stored.data = data
    else delete stored.data

    return stored
  })

  return { ...stripLevel(graph), nodes, edges } as unknown as G
}
