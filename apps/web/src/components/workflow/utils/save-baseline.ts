// apps/web/src/components/workflow/utils/save-baseline.ts

/**
 * The builder's answer to "did anyone actually change this workflow?"
 * (`plans/kopilot/workflow/22-draft-save-discipline.md` §2 R2).
 *
 * The save owner keeps a **baseline projection** of the graph as the server has
 * it, set in exactly two places — `applyFetchedWorkflow` (load and realtime
 * rehydrate) and the save response — and refuses to send a request whose
 * projection equals it. That is what kills save-on-open, save-on-pan,
 * save-on-click and measurement churn *without* enumerating which effect fired,
 * which is what every previous attempt tried and could not keep up with.
 *
 * **The trap this module exists to close.** The baseline comes from the
 * *stored* document; the live canvas graph carries `initializeWorkflow`'s
 * additions (`edge.data.sourceType`, `node.type`, filled-in handles, zIndex…).
 * So both sides run {@link dehydrateGraph} **first** and the projection is
 * taken of the dehydrated graph. Dehydration is idempotent, so a document
 * already in canonical form is untouched; a legacy fat one collapses onto the
 * same shape the canvas will produce, instead of reading as an edit forever.
 *
 * Comparison is on `stableStringify` strings — no `node:crypto` in the browser,
 * and the *same* projection the server hashes in `hashGraphSemantics`, so the
 * two sides can never disagree about what a change is.
 */

import {
  dehydrateGraph,
  type GraphDocument,
  projectGraphSemantics,
} from '@auxx/lib/workflow-engine/client'
import { stableStringify } from '@auxx/utils/json'

/** The authored content of a graph — nodes and edges, no viewport, no canvas state. */
export type GraphProjection = ReturnType<typeof projectGraphSemantics>

/**
 * A projected graph plus its comparison string. Carried together so the guard
 * compares strings (cheap, exact) while the dev diagnostic still has the object
 * form to walk.
 */
export interface ProjectedGraph {
  projection: GraphProjection
  text: string
}

/**
 * The state of the draft as the server has it. `null` fields mean "not known
 * yet" — the guard never skips a save against an unknown baseline.
 */
export interface WorkflowSaveBaseline {
  /** Projection of the stored graph document. */
  graph: ProjectedGraph | null
  /** `stableStringify` of the env-var + test-variable pair as last persisted. */
  envText: string | null
}

/** A baseline that knows nothing — every save goes through. */
export const EMPTY_SAVE_BASELINE: WorkflowSaveBaseline = { graph: null, envText: null }

/**
 * Project a graph document to its authored content.
 *
 * Dehydrates first (see the module doc): the caller may hand this a raw stored
 * row, a Kopilot-authored graph, or the live React Flow graph, and all three
 * must land on the same string when they mean the same workflow.
 */
export function projectGraph(graph: unknown): ProjectedGraph {
  const projection = projectGraphSemantics(dehydrateGraph((graph ?? {}) as GraphDocument))
  return { projection, text: stableStringify(projection) }
}

/**
 * The comparison string for the `envVars` half of a save — environment
 * variables plus the run-form test variables, which travel in the same request.
 *
 * Sorted by id so a `Map` rebuild (load, realtime rehydrate) that changes only
 * insertion order is not mistaken for an edit.
 */
export function projectEnvVars(envVars: unknown[], variables: unknown[]): string {
  return stableStringify({
    envVars: sortById(envVars),
    variables: sortById(variables),
  })
}

function sortById(items: unknown[]): unknown[] {
  return [...items].sort((a, b) => idOf(a).localeCompare(idOf(b)))
}

function idOf(item: unknown): string {
  const record = item as { id?: unknown; variableId?: unknown; name?: unknown } | null
  const candidate = record?.id ?? record?.variableId ?? record?.name
  return typeof candidate === 'string' ? candidate : ''
}

/** One differing node or edge, as the dev diagnostic prints it. */
export interface ProjectionDiff {
  /** `nodes[ai-3fj]` / `edges[e-1]`, plus `+`/`-` when the item was added or removed. */
  path: string
  /** `data.type` of the node (or of the edge's `data`), so an app write is attributable. */
  nodeType?: string
  /** Which keys differ — `data.*` is descended one level, which is where config lives. */
  changedKeys: string[]
}

/**
 * The first `limit` projection paths that differ, with the node type and the
 * changed key set (plan 22 §9.2).
 *
 * The node type and keys are not decoration: `handleNodeDataUpdate` (the
 * non-sync variant) queues nothing, so a panel's mount-time write surfaces on
 * some *later* save with no nearby cause — and an app panel's iframe write is
 * statically indistinguishable from a user edit at that seam. Printing the diff
 * at save time, regardless of who queued it, is the only way to attribute it.
 */
export function diffProjections(
  baseline: GraphProjection,
  next: GraphProjection,
  limit = 3
): ProjectionDiff[] {
  return [
    ...diffCollection('nodes', baseline.nodes, next.nodes),
    ...diffCollection('edges', baseline.edges, next.edges),
  ].slice(0, limit)
}

function diffCollection(
  kind: 'nodes' | 'edges',
  baseline: Record<string, unknown>[],
  next: Record<string, unknown>[]
): ProjectionDiff[] {
  const before = new Map(baseline.map((item) => [String(item.id), item]))
  const after = new Map(next.map((item) => [String(item.id), item]))
  const diffs: ProjectionDiff[] = []

  for (const [id, item] of after) {
    const previous = before.get(id)
    if (!previous) {
      diffs.push({ path: `+${kind}[${id}]`, nodeType: typeOf(item), changedKeys: ['*'] })
      continue
    }
    const changedKeys = changedKeysOf(previous, item)
    if (changedKeys.length > 0) {
      diffs.push({ path: `${kind}[${id}]`, nodeType: typeOf(item), changedKeys })
    }
  }

  for (const [id, item] of before) {
    if (!after.has(id)) {
      diffs.push({ path: `-${kind}[${id}]`, nodeType: typeOf(item), changedKeys: ['*'] })
    }
  }

  return diffs
}

function typeOf(item: Record<string, unknown>): string | undefined {
  const type = (item.data as { type?: unknown } | undefined)?.type
  return typeof type === 'string' ? type : undefined
}

/**
 * Which keys differ between two projected items, descending one level into
 * `data` — that is where node config lives, and `data` changed as a whole says
 * nothing useful.
 */
function changedKeysOf(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const changed: string[] = []

  for (const key of keys) {
    if (stableStringify(a[key]) === stableStringify(b[key])) continue
    if (key !== 'data') {
      changed.push(key)
      continue
    }
    const dataA = (a.data ?? {}) as Record<string, unknown>
    const dataB = (b.data ?? {}) as Record<string, unknown>
    for (const dataKey of new Set([...Object.keys(dataA), ...Object.keys(dataB)])) {
      if (stableStringify(dataA[dataKey]) !== stableStringify(dataB[dataKey])) {
        changed.push(`data.${dataKey}`)
      }
    }
  }

  return changed.sort()
}
