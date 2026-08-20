// packages/lib/src/workflows/graph-projection.ts

import { isDerivedKey } from '../workflow-engine/catalog/derived-keys'
import { DEFAULT_SOURCE_HANDLE, DEFAULT_TARGET_HANDLE } from '../workflow-engine/catalog/graph-vars'

/**
 * React Flow interaction state and load-time derivations that live on the node
 * OBJECT but carry no authored meaning.
 *
 * Three groups, all of which rewrite themselves without anyone editing anything:
 *
 *  - **interaction state** — `selected`, `dragging`, `resizing`, and the
 *    `*able` flags. Clicking a node rewrites these, and the editor autosaves
 *    the result.
 *  - **measurement** — `measured`, `positionAbsolute`, and the top-level
 *    `width`/`height` pair. These STAY in the stored document (a container
 *    resize writes a real authored size) but must never *trigger* a save; the
 *    authored size rides on `data.width`/`data.height`, which are content.
 *  - **re-derived on load** — `type` (`'standard'`/`'note'`, rebuilt from
 *    `data.type` by `initializeWorkflow`) and `zIndex`. A graph Kopilot just
 *    wrote carries neither, so without this the next builder open is a real
 *    document diff (plans/kopilot/workflow/22 §1.3).
 *
 * `position` is deliberately NOT here: dragging a node is a real edit. Neither
 * is `parentId` — it is authored containment AND the input every containment
 * derivation reads.
 */
export const EPHEMERAL_NODE_KEYS: ReadonlySet<string> = new Set([
  // interaction state
  'selected',
  'dragging',
  'resizing',
  'selectable',
  'focusable',
  'deletable',
  'draggable',
  // measurement / layering
  'zIndex',
  'width',
  'height',
  'measured',
  'positionAbsolute',
  // re-derived by `initializeWorkflow` from `data.type`
  'type',
  // template-authoring aid that leaked into live documents
  // (`TemplateGraphTransformer.cloneGraph` strips it from `data`, not the node)
  '$comment',
])

/** Ephemeral state on an edge — same argument as {@link EPHEMERAL_NODE_KEYS}. */
export const EPHEMERAL_EDGE_KEYS: ReadonlySet<string> = new Set([
  'selected',
  'animated',
  // re-derived by `initializeWorkflow` via `calculateZIndex`
  'zIndex',
  '$comment',
])

/**
 * Keys under `node.data` that are recomputed on every load or have never held
 * information (plans/kopilot/workflow/23 §1.2).
 *
 * `isInLoop`/`loopId` are re-derived from `parentId`; `isValid`/`errors` are
 * hardcoded `true`/`[]` by both writers and read by nobody (the live indicator
 * re-runs the validator); `selected` duplicates the top-level React Flow prop
 * that shadows it; `outputVariables` is legacy residue.
 *
 * NOT here, and it matters: `desc` and `collapsed` are authored, and `position`
 * under `form-input`'s data is a fractional RUN-FORM ORDERING KEY (`"a0"`,
 * `"a1"`), not a coordinate.
 */
export const EPHEMERAL_NODE_DATA_KEYS: ReadonlySet<string> = new Set([
  'isInLoop',
  'loopId',
  'isValid',
  'errors',
  'selected',
  'outputVariables',
])

/**
 * Keys under `edge.data` that `initializeWorkflow` re-manufactures from the
 * endpoint nodes on every load.
 *
 * **Scoped to `edge.data` on purpose.** `node.data.sourceType` is AUTHORED
 * config on `document-extractor` (where the document comes from); stripping
 * `sourceType` at node level would make a real config change invisible.
 */
export const EPHEMERAL_EDGE_DATA_KEYS: ReadonlySet<string> = new Set([
  'sourceType',
  'targetType',
  'isInLoop',
  'loopId',
  'isLoopBackEdge',
])

/**
 * Recursively drop every `_`-prefixed key, at ANY depth.
 *
 * The existing save-seam strip (`stripDerivedKeys`) is applied to `node.data`
 * and `edge.data` **and nowhere else**, so a derived key on the node or edge
 * *object* persists forever — `edge._waitingRun` sits in 16 stored edges,
 * including two published versions (plans/kopilot/workflow/23 §3.1). The
 * projection owns the invariant at every level.
 */
function stripDerivedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDerivedDeep)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isDerivedKey(key)) continue
    out[key] = stripDerivedDeep(entry)
  }
  return out
}

function projectData(data: unknown, drop: ReadonlySet<string>): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return stripDerivedDeep(data)
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (drop.has(key) || isDerivedKey(key)) continue
    out[key] = stripDerivedDeep(value)
  }
  return out
}

/**
 * An EMPTY `data` object and an absent one are the same document.
 *
 * This is not tidiness — it is the whole point. `initializeWorkflow` writes
 * `edge.data = { sourceType, targetType }` onto edges that a Kopilot-authored
 * graph left with no `data` key at all, and every one of those keys is derived.
 * Project them away and the edge is left holding `data: {}` against a baseline
 * holding nothing, so a plain builder open would still read as an edit — which
 * is exactly the bug this projection exists to kill.
 */
function isEmptyRecord(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  )
}

function projectItem(
  item: unknown,
  drop: ReadonlySet<string>,
  dropData: ReadonlySet<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((item ?? {}) as Record<string, unknown>)) {
    if (drop.has(key) || isDerivedKey(key)) continue
    if (key === 'data') {
      const data = projectData(value, dropData)
      if (data != null && !isEmptyRecord(data)) out.data = data
      continue
    }
    out[key] = stripDerivedDeep(value)
  }
  return out
}

/**
 * A handle is content ONLY when it is not the default.
 *
 * Non-default handles carry branch routing — if-else `case_id`s, classifier
 * category ids, loop handles — and a rewire from one branch to another can
 * change nothing else in the document. But `'source'`/`'target'` are what the
 * loader fills in for an absent handle (720 stored edges omit `sourceHandle`),
 * so treating "absent" and "the default" as different documents would make
 * every open of a Kopilot-authored graph look like an edit.
 */
function isDefaultHandle(value: unknown, fallback: string): boolean {
  return value == null || value === fallback
}

/**
 * The AUTHORED content of a workflow graph: nodes and edges with React Flow's
 * interaction state, the canvas's measurements, every `_`-prefixed derived key
 * and everything the load path re-manufactures removed.
 *
 * PURE and client-safe — no `node:crypto`, no I/O — so the browser can compare
 * `stableStringify(projectGraphSemantics(graph))` against a baseline to answer
 * "did anyone actually change this workflow?" with the exact same definition of
 * *change* the server uses in {@link hashGraphSemantics}
 * (plans/kopilot/workflow/22 R2).
 *
 * What survives, deliberately: `node.position` (a drag is an edit), `parentId`,
 * non-default `sourceHandle`/`targetHandle`, node and edge ids, the node/edge
 * sets, and every non-derived key under `data` — including `data.width`/
 * `data.height`, which is how a container **resize** stays visible while the
 * `ResizeObserver` writeback to the top-level pair does not.
 *
 * What never survives: anything not on a node or an edge. `viewport` is a view
 * preference, not a property of the workflow, and is dropped by construction.
 */
export function projectGraphSemantics(graph: unknown): {
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
} {
  const g = (graph ?? {}) as { nodes?: unknown[]; edges?: unknown[] }
  return {
    nodes: (g.nodes ?? []).map((node) =>
      projectItem(node, EPHEMERAL_NODE_KEYS, EPHEMERAL_NODE_DATA_KEYS)
    ),
    edges: (g.edges ?? []).map((edge) => {
      const projected = projectItem(edge, EPHEMERAL_EDGE_KEYS, EPHEMERAL_EDGE_DATA_KEYS)
      if (isDefaultHandle(projected.sourceHandle, DEFAULT_SOURCE_HANDLE)) {
        delete projected.sourceHandle
      }
      if (isDefaultHandle(projected.targetHandle, DEFAULT_TARGET_HANDLE)) {
        delete projected.targetHandle
      }
      return projected
    }),
  }
}
