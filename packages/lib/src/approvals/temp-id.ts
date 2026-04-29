// packages/lib/src/approvals/temp-id.ts

import type { ProposedAction } from './types'

/**
 * Pattern for engine-minted temp ids: `temp_<n>` where `n` is the action's
 * `localIndex` at capture time. Anchored — substitution and detection both
 * require the WHOLE string to match (no embedded `temp_3` inside `…temp_3…`).
 */
export const TEMP_ID_PATTERN = /^temp_(\d+)$/

/**
 * Topologically sort actions by their `temp_<n>` arg references.
 *
 * Action B depends on action A iff B.args contains the literal string
 * `temp_<A.localIndex>` anywhere (recursive walk). Phase 3a guarantees that
 * `temp_<n>` references only point at *prior* localIndices, so cycles are
 * structurally impossible — but we assert anyway and throw on a detected
 * cycle since silent UB would be worse than a visible failure.
 *
 * Returns actions in execution order: every action's dependencies come before
 * it. Order within a dependency level falls back to ascending `localIndex`
 * for determinism.
 */
export function topoSortActions(actions: ProposedAction[]): ProposedAction[] {
  const byIndex = new Map<number, ProposedAction>()
  for (const a of actions) byIndex.set(a.localIndex, a)

  const deps = new Map<number, Set<number>>()
  for (const action of actions) {
    deps.set(action.localIndex, collectTempDeps(action.args))
  }

  const visited = new Set<number>()
  const visiting = new Set<number>()
  const out: ProposedAction[] = []

  function visit(idx: number) {
    if (visited.has(idx)) return
    if (visiting.has(idx)) {
      throw new Error(`Cycle detected in action graph at localIndex=${idx}`)
    }
    visiting.add(idx)
    const action = byIndex.get(idx)
    if (!action) return // unknown reference — drop, caller handles missing deps as skip
    const sortedDeps = [...(deps.get(idx) ?? [])].sort((a, b) => a - b)
    for (const dep of sortedDeps) visit(dep)
    visiting.delete(idx)
    visited.add(idx)
    out.push(action)
  }

  const sortedRoots = [...byIndex.keys()].sort((a, b) => a - b)
  for (const idx of sortedRoots) visit(idx)
  return out
}

/**
 * Walk `args` recursively, returning every `temp_<n>` localIndex referenced
 * (as numbers). A reference must be the entire string value of a leaf —
 * substrings like `"please review temp_3 first"` do NOT count, since the
 * model isn't supposed to embed temp ids in prose and a substring match
 * would risk corrupting unrelated values.
 */
export function collectTempDeps(args: unknown): Set<number> {
  const out = new Set<number>()
  walk(args, (value) => {
    if (typeof value !== 'string') return
    const m = TEMP_ID_PATTERN.exec(value)
    if (m?.[1]) out.add(Number(m[1]))
  })
  return out
}

/**
 * Substitute `temp_<n>` leaf strings inside `args` with values from the
 * substitution map. Returns a fresh structure — does NOT mutate the input.
 *
 * Missing keys in the map are left as-is. Caller must call
 * `assertNoUnresolvedTempIds` afterwards to surface the leftover before
 * invoking the tool — running a tool with a literal `"temp_3"` string would
 * either fail confusingly or, worse, succeed with garbage.
 */
export function substituteTempIds(
  args: Record<string, unknown>,
  substitutions: Map<string, string>
): Record<string, unknown> {
  return mapStrings(args, (value) => {
    if (typeof value !== 'string') return value
    const sub = substitutions.get(value)
    return sub ?? value
  }) as Record<string, unknown>
}

/**
 * Assert that no leaf string in `args` still matches the temp-id pattern.
 * Throws if any does — Phase 3e's apply-time path treats this as a missed
 * substitution / topo-sort bug and refuses to invoke the tool with bad args.
 */
export function assertNoUnresolvedTempIds(args: unknown): void {
  walk(args, (value) => {
    if (typeof value !== 'string') return
    if (TEMP_ID_PATTERN.test(value)) {
      throw new Error(`Unresolved temp id "${value}" in args after substitution`)
    }
  })
}

// ===== INTERNAL =====

function walk(value: unknown, visit: (leaf: unknown) => void): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, visit)
    return
  }
  visit(value)
}

function mapStrings(value: unknown, fn: (leaf: unknown) => unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = mapStrings(v, fn)
    }
    return out
  }
  return fn(value)
}
