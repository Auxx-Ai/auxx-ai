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
 * place (plan 21 §9.2/§10.5).
 *
 * Ids are always candidates; a name is one only if it is an address. A
 * `positionalName` branch is offered by id alone — suggesting its label would
 * hand back the very string that cannot be used, and acting on the suggestion
 * re-introduces the position bug (plan 28 §3.3). Those get {@link
 * positionalLabelHit} instead, which explains itself.
 */
function nearestBranches(branchRef: string, branches: NodeBranch[]): NodeBranch[] {
  const candidates = branches.flatMap((b) =>
    b.name && !b.positionalName ? [b.name, b.id] : [b.id]
  )
  const near = closestMatches(branchRef, candidates)
  const matched: NodeBranch[] = []
  for (const candidate of near) {
    const branch = branches.find(
      (b) => (b.name === candidate && !b.positionalName) || b.id === candidate
    )
    if (branch && !matched.includes(branch)) matched.push(branch)
  }
  return matched
}

/**
 * The branch whose POSITIONAL label the caller just tried to address, if any.
 *
 * Exact match first, then the same edit-distance tolerance the "did you mean"
 * uses, so `"CASE2"` is diagnosed as the positional attempt it is rather than
 * falling through to a generic candidate list. What comes back is the branch
 * currently WEARING that label — the answer to "which one did I mean?" at this
 * instant, and the id that must be used in its place.
 */
function positionalLabelHit(branchRef: string, branches: NodeBranch[]): NodeBranch | undefined {
  const positional = branches.filter((b) => b.positionalName && b.name)
  if (positional.length === 0) return undefined
  const needle = branchRef.toLowerCase()
  const exact = positional.find((b) => b.name.toLowerCase() === needle)
  if (exact) return exact
  const [nearest] = closestMatches(
    branchRef,
    positional.map((b) => b.name)
  )
  return nearest ? positional.find((b) => b.name === nearest) : undefined
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
 *   name then id; no match is an error naming the candidates. A branch whose
 *   name is a positional label (`positionalName`) is addressable by id ONLY,
 *   and trying its label is its own error saying so.
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
  // Ids beat names on a tie, and a `positionalName` label is not tried at all:
  // an if-else label is a function of array position, so `"CASE 2"` used to
  // resolve to whatever was second at that instant and an inserted case
  // silently re-pointed the edge (plan 28 §3.3).
  const match =
    branches.find((b) => !b.positionalName && b.name.toLowerCase() === needle) ??
    branches.find((b) => b.id.toLowerCase() === needle)
  if (!match) {
    const positional = positionalLabelHit(branchRef, branches)
    if (positional) {
      // Named, not merely listed: the logged turn re-issued a label verbatim
      // because the rejection never said the label was the problem.
      return err(
        new BadRequestError(
          `"${branchRef}" is a display label on node ${describeNode(source)}, not a branch ` +
            'address. This node numbers its branches by position, so the label moves to a ' +
            'different branch as soon as a case is added or removed. Address it by id: the ' +
            `branch labelled "${positional.name}" is currently "${positional.id}". ` +
            `Available branches: ${branches.map(describeBranch).join(', ')}.`
        )
      )
    }
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
