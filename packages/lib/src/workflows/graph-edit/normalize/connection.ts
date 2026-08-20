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
import { DEFAULT_SOURCE_HANDLE, safeBranches } from '../branches'
import { closestMatches, describeNode, resolveNodeRef } from '../refs'
import type { NodeMeta } from '../types'

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
 * "Did you mean" for a branch that missed — the same `closestMatches`
 * tolerance a node ref already gets (`refs.ts`).
 *
 * Worth the few lines because a flat rejection is retried verbatim: the logged
 * turn re-issued `branch: "IF"` unchanged after re-reading the whole workflow,
 * because nothing in the rejection pointed at the branch that had taken `IF`'s
 * place (plan 21 §9.2/§10.5). Names AND ids are candidates, since either is a
 * legal address.
 */
function nearestBranches(branchRef: string, branches: NodeBranch[]): NodeBranch[] {
  const candidates = branches.flatMap((b) => (b.name ? [b.name, b.id] : [b.id]))
  const near = closestMatches(branchRef, candidates)
  const matched: NodeBranch[] = []
  for (const candidate of near) {
    const branch = branches.find((b) => b.name === candidate || b.id === candidate)
    if (branch && !matched.includes(branch)) matched.push(branch)
  }
  return matched
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
  // `safeBranches`, not a bare call: a degenerate config (an if-else with no
  // cases) used to throw straight out of this read path (plan 21 §2.5).
  const branches = safeBranches(manifest, source.data)

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
    const near = nearestBranches(branchRef, branches)
    return err(
      new BadRequestError(
        `No branch "${branchRef}" on node ${describeNode(source)}.` +
          (near.length > 0 ? ` Did you mean ${near.map(describeBranch).join(' or ')}?` : '') +
          ` Available branches: ${branches.map(describeBranch).join(', ')}.` +
          ' Address a branch by its id (the value in parentheses) — every node read and write ' +
          'returns the node\u2019s current `branches`.'
      )
    )
  }

  return ok({ sourceNodeId: source.id, sourceHandle: match.id })
}
