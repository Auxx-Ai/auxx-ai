// apps/web/src/components/workflow/store/branch-scope.ts

import {
  type NodeErrorHandling,
  scopeOutputsToHandle,
  type UnifiedVariable,
} from '@auxx/lib/workflow-engine/client'

/**
 * What an ancestor advertises to ONE consumer, given the branches that
 * consumer is reachable on.
 */
export interface ScopedAncestorOutputs {
  /** Top-level declared variables that survive on at least one reachable handle. */
  variables: UnifiedVariable[]
  /**
   * Ids of the entries in {@link variables} that survive on SOME reachable
   * handle but not all — `union − intersection`. Always empty when the
   * consumer is reachable on a single handle.
   */
  conditional: Set<string>
}

const EMPTY_CONDITIONAL: ReadonlySet<string> = new Set<string>()

/**
 * Narrow an ancestor's declared outputs to what the consumer can actually read,
 * and flag the ones that are path-conditional. Plan 24 §4.2 / §4.6.
 *
 * **Union over paths, not intersection.** A variable is offered if SOME path to
 * the consumer carries it. Intersection is the "guaranteed present" rule and is
 * the wrong one: it breaks the legitimate one-node-handles-both-outcomes
 * pattern, it can be empty at a fan-in, and the two failure modes are
 * asymmetric — an over-offered variable interpolates to `''` with a WARN, while
 * an under-offered one is a false refusal on a correct edit.
 *
 * Three outcomes per variable, and no fourth:
 * - on no reachable handle → **absent** from `variables` (hard-filtered);
 * - on some but not all → present, and its id is in `conditional` (marked);
 * - on all → present, unmarked.
 *
 * This is the browser half of the contract `ref-check.ts`'s `scopeIssue`
 * implements server-side. Both call the SAME {@link scopeOutputsToHandle}, so
 * they cannot drift on what a handle carries — only on how they walk the graph,
 * which is what `parity/branch-scope-parity.test.ts` pins.
 *
 * Operates on TOP-LEVEL variables only. Callers flatten afterwards: filtering a
 * flattened list would drop `record.email` while keeping `record`, since only
 * the root of a tree carries a name `failOutputs` can match.
 */
export function scopeAncestorOutputs(params: {
  ancestorId: string
  /** The handles this ancestor reaches the consumer on. */
  handles: Set<string> | undefined
  /** The ancestor's full declared output tree, the union across handles. */
  declared: UnifiedVariable[]
  /** The ancestor manifest's failure-policy declaration, if it has one. */
  errorHandling: NodeErrorHandling | undefined
  /** The ancestor's persisted node data — read for `error_strategy`. */
  config: unknown
}): ScopedAncestorOutputs {
  const { ancestorId, handles, declared, errorHandling, config } = params

  // No handle information (a container ancestor, or a type with no manifest)
  // means no basis to narrow. Absent `errorHandling` means the type never
  // declared a per-handle difference, so every handle carries everything —
  // the same opt-in discipline the manifest field itself uses.
  if (!handles || handles.size === 0 || !errorHandling) {
    return { variables: declared, conditional: EMPTY_CONDITIONAL as Set<string> }
  }

  // One pass per handle. `handles` is at most {source, fail} in today's
  // catalog (plan 24 §3), so this is two calls, not a fan-out.
  let union: Set<string> | undefined
  let intersection: Set<string> | undefined
  for (const handle of handles) {
    const surviving = new Set(
      scopeOutputsToHandle(errorHandling, config, ancestorId, handle, declared).map((v) => v.id)
    )
    if (!union || !intersection) {
      union = new Set(surviving)
      intersection = new Set(surviving)
      continue
    }
    for (const id of surviving) union.add(id)
    for (const id of intersection) {
      if (!surviving.has(id)) intersection.delete(id)
    }
  }

  if (!union || !intersection) {
    return { variables: declared, conditional: EMPTY_CONDITIONAL as Set<string> }
  }

  const conditional = new Set<string>()
  for (const id of union) {
    if (!intersection.has(id)) conditional.add(id)
  }

  return { variables: declared.filter((v) => union.has(v.id)), conditional }
}

/**
 * Stamp `pathConditional` through a variable and everything under it.
 *
 * Returns a shallow clone rather than mutating: the source objects are the
 * cached `nodeOutputs` trees, shared by every consumer and by the
 * `variableIndex`, and conditionality is per-consumer. Mutating would leak one
 * node's marking onto every other reader of the same producer.
 *
 * The subtree inherits the root's flag because that is what the flag means: if
 * `record` is written on only some reachable paths, so is `record.email`.
 */
export function markPathConditional(variable: UnifiedVariable): UnifiedVariable {
  const marked: UnifiedVariable = { ...variable, pathConditional: true }
  if (variable.properties) {
    marked.properties = Object.fromEntries(
      Object.entries(variable.properties).map(([key, prop]) => [key, markPathConditional(prop)])
    )
  }
  if (variable.items) {
    marked.items = markPathConditional(variable.items)
  }
  return marked
}
