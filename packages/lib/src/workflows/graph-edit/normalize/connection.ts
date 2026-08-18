// packages/lib/src/workflows/graph-edit/normalize/connection.ts

/**
 * Friendly connection resolution (`03-graph-edit-service.md` §3 rows 6–7) —
 * pure, browser-safe.
 *
 * `after: "<title-or-id>"` names the predecessor node; `branch: "no match"`
 * names one of its outgoing branches. The branch id is resolved through
 * `manifest.connection.branches(config)` from the catalog registry — the
 * single source for the handle ids the canvas renders and the processors
 * emit — NEVER string-matched locally, so a rename of a branch-derivation rule
 * can't silently detach agent-authored edges.
 *
 * The manifest arrives as a `ManifestLookup` rather than being read from the
 * registry here, so an app block resolves through the same path as a core type.
 * App blocks declare no branches, so they keep landing on `source` — but by
 * their manifest saying so, not by their manifest being absent.
 */

import { err, ok, type Result } from 'neverthrow'
import { type AuxxError, BadRequestError } from '../../../errors'
import type { ManifestLookup, NodeBranch } from '../../../workflow-engine/catalog/types'
import { describeNode, resolveNodeRef } from '../refs'
import type { NodeMeta } from '../types'

/** The default source handle for a node with no branch handles. */
const DEFAULT_SOURCE_HANDLE = 'source'

/** A resolved `after`/`branch` pair, ready to become an edge. */
export interface ConnectionSpec {
  sourceNodeId: string
  sourceHandle: string
}

/** `Name (id)` / `id` — the candidate format branch errors use. */
function describeBranch(branch: NodeBranch): string {
  return branch.name ? `"${branch.name}" (${branch.id})` : `"${branch.id}"`
}

/**
 * Resolve `after` (node title or id) and optional `branch` (branch name or
 * handle id, case-insensitive) to the edge source the mutation should write.
 *
 * - No branch given: nodes without branch handles connect on the default
 *   `source` handle; nodes with exactly one `default`-kind branch use it;
 *   nodes with several (if-else cases, classifier categories) are an error
 *   naming every branch — never a guess.
 * - Branch given: matched against `manifest.connection.branches(config)` by
 *   name then id; no match is an error naming the candidates.
 */
export function resolveConnectionSpec(
  nodes: NodeMeta[],
  params: { after: string; branch?: string },
  lookup: ManifestLookup
): Result<ConnectionSpec, AuxxError> {
  const resolved = resolveNodeRef(nodes, params.after)
  if (resolved.isErr()) return err(resolved.error)
  const source = resolved.value.node

  const nodeType: string | undefined = source.data?.type ?? source.type
  const manifest = nodeType ? lookup(nodeType) : undefined
  const branches = manifest?.connection.branches?.(source.data) ?? []

  const branchRef = params.branch?.trim()
  if (!branchRef) {
    if (branches.length === 0) {
      return ok({ sourceNodeId: source.id, sourceHandle: DEFAULT_SOURCE_HANDLE })
    }
    const defaults = branches.filter((b) => b.kind === 'default')
    if (defaults.length === 1) {
      return ok({ sourceNodeId: source.id, sourceHandle: defaults[0]!.id })
    }
    return err(
      new BadRequestError(
        `Node ${describeNode(source)} has ${branches.length} branches — specify one: ` +
          `${branches.map(describeBranch).join(', ')}.`
      )
    )
  }

  if (branches.length === 0) {
    return err(
      new BadRequestError(
        `Node ${describeNode(source)} has no branches — omit "branch" to connect its output.`
      )
    )
  }

  const needle = branchRef.toLowerCase()
  const match =
    branches.find((b) => b.name.toLowerCase() === needle) ??
    branches.find((b) => b.id.toLowerCase() === needle)
  if (!match) {
    return err(
      new BadRequestError(
        `No branch "${branchRef}" on node ${describeNode(source)}. Available branches: ` +
          `${branches.map(describeBranch).join(', ')}.`
      )
    )
  }

  return ok({ sourceNodeId: source.id, sourceHandle: match.id })
}
