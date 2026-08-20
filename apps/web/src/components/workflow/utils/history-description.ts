// apps/web/src/components/workflow/utils/history-description.ts

import type { HistoryDescription, HistoryEntry } from '../store/types'
import type { FlowNode } from '../types'

/**
 * Turns "which event, on which node" into what the history popover shows.
 *
 * Kept out of the hook and off the manager because the interesting half is a
 * pure comparison of two graphs, and because `HistoryManager` has no business
 * knowing what a workflow node is.
 *
 * ## Why the baseline is a parameter
 *
 * Two of the three things this derives are only knowable against the state the
 * entry is recorded ON TOP OF:
 *
 * - **Delete.** The node is gone from the new graph, so the baseline is the
 *   only place its name still exists.
 * - **Rename.** `useNodeCrud.setInputs` hands the update path a whole data
 *   object, so the *call site* genuinely cannot say which field moved — but
 *   `prior.title !== current.title` is one lookup away for anything holding
 *   both graphs. This is the case the coarse-label decision (no
 *   `NodeTitleChange` member) was right to give up on at the call site and
 *   wrong to give up on entirely.
 */
export interface DescribeHistoryInput {
  /** Bare verb — `added`, `changed`, `moved`. Absent for events with no node subject. */
  verb?: string
  /** Sentence used when there is no single named subject: `Node added`. */
  fallbackLabel: string
  /** The node this action is about, when it is exactly one. */
  nodeId?: string
  /** Nodes affected, when more than one. Suppresses the subject. */
  count?: number
  /** Report a changed title as a rename. `NodeChange` only. */
  detectRename?: boolean
  /** The graph as it is AFTER the action. */
  nodes: readonly FlowNode[]
}

/** A node's display title, matching `useNodeTitle`'s precedence. */
function titleOf(node: FlowNode | undefined): string | undefined {
  const data = node?.data as { title?: unknown; label?: unknown } | undefined
  const title = data?.title ?? data?.label
  return typeof title === 'string' && title.trim() ? title : undefined
}

function typeOf(node: FlowNode | undefined): string | undefined {
  const type = (node?.data as { type?: unknown } | undefined)?.type
  return typeof type === 'string' ? type : undefined
}

export function describeHistoryEntry(
  input: DescribeHistoryInput,
  baseline: HistoryEntry | undefined
): HistoryDescription {
  const { verb, fallbackLabel, nodeId, count, detectRename, nodes } = input

  // More than one node moved: there is no single thing to badge, and naming one
  // of several is worse than naming none.
  if (count !== undefined && count > 1) {
    return { label: `${count} nodes ${verb ?? 'changed'}` }
  }

  if (!verb || !nodeId) return { label: fallbackLabel }

  const current = nodes.find((node) => node.id === nodeId)
  const priorNodes = (baseline?.data?.nodes ?? undefined) as FlowNode[] | undefined
  const prior = priorNodes?.find((node) => node.id === nodeId)

  const node = current ?? prior
  const title = titleOf(current) ?? titleOf(prior)
  // An untitled node has nothing worth badging; the plain sentence is honest.
  if (!node || !title) return { label: fallbackLabel }

  const nodeType = typeOf(node)

  if (detectRename && current && prior) {
    const before = titleOf(prior)
    const after = titleOf(current)
    if (before && after && before !== after) {
      return {
        verb: 'renamed to',
        subject: { id: nodeId, title: before, nodeType },
        renamedTo: after,
        label: `${before} renamed to ${after}`,
      }
    }
  }

  return {
    verb,
    subject: { id: nodeId, title, nodeType },
    label: `${title} ${verb}`,
  }
}
