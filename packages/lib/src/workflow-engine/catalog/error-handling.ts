// packages/lib/src/workflow-engine/catalog/error-handling.ts

import { z } from 'zod'
import type { UnifiedVariable } from '../types/unified-variable'
import type { NodeBranch } from './types'

/**
 * The ONE failure-policy vocabulary for the node catalog.
 *
 * There used to be two, and they were not the same set: `ErrorStrategy`
 * (`catalog/nodes/http.ts`) was `none | fail | default` defaulting to
 * `default`, and `CrudErrorStrategy` (`catalog/nodes/crud.ts`) was
 * `fail | continue | default` defaulting to `fail`. http's `none` and crud's
 * `continue` are the SAME concept — succeed anyway, stay on `source`, carry
 * the error in the output — under two names, neither node offered the other's
 * name, and the two defaults disagreed, so "what happens when this node fails"
 * depended on which node you dropped on the canvas (plan 21 §15.1).
 *
 * The reframe that makes this one concern (plan 21 §15.3): `error_strategy` is
 * NOT "does this node have a fail branch". It is *what happens when this node
 * fails*, and exactly ONE of its values produces a branch:
 *
 * | policy     | node status | outputHandle | output                        |
 * |------------|-------------|--------------|-------------------------------|
 * | `fail`     | Failed      | `fail`       | the error                     |
 * | `continue` | Succeeded   | `source`     | error payload, `success:false` |
 * | `default`  | Succeeded   | `source`     | the configured substitutes    |
 *
 * `continue` and `default` never touch the branch machinery at all — they
 * change the node's *output*, not its *routing*.
 */
export enum ErrorStrategy {
  /** Fail the node and leave via the declared, wireable `fail` branch. */
  fail = 'fail',
  /**
   * Succeed anyway, stay on `source`, carry the error in the output.
   *
   * OFFERED BY `http` ONLY (plan 24 §6.5). It is part of the vocabulary — the
   * legacy `'none'` normalizes to it and persisted rows must keep parsing —
   * but a type only puts it in `strategies` when its outputs are NOT the
   * reason it exists.
   *
   * The rule is structural, not taste. Handle scoping is only honest when the
   * handle partitions the outcomes: under `fail`, `source` means "it worked";
   * under `continue`, two outcomes collapse onto one handle, so `source` means
   * "maybe" and there is no second handle to scope against. A crud node on
   * `continue` marches down the happy path with no `record` written and
   * nothing on the canvas admitting it. `fail` plus a fail edge that rejoins
   * the main flow reproduces `continue` exactly and shows it.
   */
  continue = 'continue',
  /** Succeed anyway, stay on `source`, substitute the configured values. */
  default = 'default',
}

/**
 * What an unconfigured node does. Settled in plan 21 §18.1: it is crud's
 * default today, it is what http *actually* does today (its stored
 * `'default'` with an empty `default_value` falls straight through to the
 * fail arm), and it is the only value that cannot silently swallow an error.
 */
export const DEFAULT_ERROR_STRATEGY = ErrorStrategy.fail

/**
 * Legacy persisted values that are read but never written again.
 *
 * `'none'` was http's name for `continue`. Existing http configs carry it, so
 * every read path — the manifests' `connection.branches`, both processors, and
 * the panel — must go through {@link normalizeErrorStrategy} rather than
 * comparing the raw string.
 */
const LEGACY_ALIASES: Record<string, ErrorStrategy> = {
  none: ErrorStrategy.continue,
}

const STRATEGY_VALUES = new Set<string>(Object.values(ErrorStrategy))

/**
 * Output handles that signal a failure outcome.
 *
 * `'fail'` is the only one any node RENDERS or any processor emits. `'onError'`
 * stays because it is still live STORED-edge vocabulary: `findFailureEdge`
 * (`core/graph-navigation.ts`) keeps it as the legacy back-compat lookup, and
 * `contract-drift-allowlist.ts` tracks retiring it as an open question.
 *
 * Declared here, beside the policy that produces the handle, so the graph
 * builder and {@link scopeOutputsToHandle} share one spelling instead of two
 * that can drift. Anything added here becomes a handle whose outputs get
 * scoped, so keep it to handles a run can actually leave on.
 */
export const ERROR_LIKE_HANDLES: ReadonlySet<string> = new Set(['fail', 'onError'])

/** Whether an output handle is the failure door. See {@link ERROR_LIKE_HANDLES}. */
export function isErrorLikeHandle(handle: string | null | undefined): boolean {
  return typeof handle === 'string' && ERROR_LIKE_HANDLES.has(handle)
}

/** A node type's declared failure-policy support, hung off its `NodeManifest`. */
export interface NodeErrorHandling {
  /** Which policies this type supports — a subset of fail | continue | default. */
  strategies: ErrorStrategy[]
  /** What an unconfigured node does. */
  defaultStrategy: ErrorStrategy

  /**
   * Which of this type's declared outputs a run leaving via the `fail` branch
   * actually writes. Top-level paths WITHOUT the `<nodeId>.` prefix;
   * {@link scopeOutputsToHandle} strips it before matching. Everything else the
   * resolver declares exists only on `source`.
   *
   * ABSENT ⇒ the fail branch carries everything (the behaviour before plan 24),
   * so adding this field changes nothing until a type declares it — the same
   * opt-in discipline `errorHandling` itself uses.
   *
   * An EMPTY array is meaningful and different from absent: it says the fail
   * path writes nothing, which is literally true of a node whose fail arm
   * returns without touching the context.
   */
  failOutputs?: string[]

  /**
   * The subset of {@link failOutputs} that describes a FAILURE and is therefore
   * absent from `source` — but ONLY under {@link ErrorStrategy.fail}, because
   * that is the only policy under which a failure leaves by another door.
   * Under `continue` and `default` the failure lands on `source` and nothing is
   * subtracted.
   *
   * MUST be a subset of `failOutputs`; `error-handling.test.ts` asserts it.
   *
   * Two lists rather than one because the keys partition THREE ways, and one
   * list cannot express three (plan 24 §6.1a):
   *
   * ```
   * always:      operation, resourceType, success   ← written on both paths
   * source-only: <entityDef>.*, id, record, deleted ← never declared directly
   * fail-only:   error, errorDetails                ← this field
   * ```
   *
   * `failOutputs = always ∪ fail-only`, so `always` falls out as the
   * difference. `source-only` is never named: crud's record tree is based on a
   * runtime `EntityDefinition` CUID that no static manifest can spell, which is
   * why this is an allowlist of the small stable failure side rather than a
   * denylist of the big one.
   */
  failureOnlyOutputs?: string[]

  /**
   * Declared output paths that must NOT be offered as `default` substitutes,
   * even though the resolver declares them.
   *
   * Only needed when a type's failure handler writes a key BEFORE the strategy
   * switch, so a configured substitute for it would either be silently
   * overwritten or would let the author state something untrue. crud is the
   * one such type today: `handleCrudError` writes the five-key status block
   * unconditionally, and a `success: true` substitute on a failed create is a
   * lie the rest of the graph would believe.
   *
   * NOT derivable from {@link failOutputs}, even though crud's two lists
   * coincide. http's `failOutputs` is `['status', 'error', 'success']` and
   * `status` is precisely the substitute the editor exists to set (plan 24
   * §9.1) — subtracting `failOutputs` here would break the headline fix.
   */
  defaultValueExclude?: string[]
}

/**
 * Resolve a persisted `error_strategy` to a policy, applying the legacy
 * aliases. An absent or unrecognised value resolves to `fallback`, which is
 * what the node's manifest declares as its `defaultStrategy` (and, absent a
 * manifest, {@link DEFAULT_ERROR_STRATEGY}).
 *
 * @param value the raw persisted value — may be `undefined`, `'none'`, …
 * @param fallback the policy an unconfigured node runs under
 */
export function normalizeErrorStrategy(
  value: unknown,
  fallback: ErrorStrategy = DEFAULT_ERROR_STRATEGY
): ErrorStrategy {
  if (typeof value !== 'string') return fallback
  if (STRATEGY_VALUES.has(value)) return value as ErrorStrategy
  return LEGACY_ALIASES[value] ?? fallback
}

/**
 * Does this config select the one policy that produces a branch?
 *
 * Deliberately answers `false` for an ABSENT `error_strategy` rather than
 * falling back to `DEFAULT_ERROR_STRATEGY`: the branch question is about what
 * the canvas renders and what an edge may address, and every `node.tsx`
 * renders its `fail` handle on the stored value alone. Synthesising a wireable
 * branch for a node that never rendered one would break the handle contract
 * the parity suite asserts (`builder-rendered-handles.ts`).
 */
export function hasFailBranch(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false
  const raw = (config as { error_strategy?: unknown }).error_strategy
  if (typeof raw !== 'string') return false
  return normalizeErrorStrategy(raw) === ErrorStrategy.fail
}

/**
 * The branch a failure policy contributes — the single site that turns
 * `error_strategy: 'fail'` into a handle.
 *
 * Returns `[]` for `continue` / `default` / unset. Node manifests spread this
 * into their own branch list beside their `source` handle, so no node type
 * re-implements the rule; the graph builder and the canvas's
 * `calculateTargetBranches` call it too, which is what makes crud's missing
 * graph-builder arm (plan 21 §7.3) unrepresentable rather than patched.
 *
 * Takes `unknown` rather than `{ error_strategy?: unknown }` because the four
 * call sites hand it four different shapes of persisted node data — a catalog
 * `TConfig`, the engine's `NodeData`, the canvas's `FlowNode['data']` union —
 * and a parameter whose properties are all optional is a *weak type*, which TS
 * rejects for any argument that shares none of them.
 */
export function errorHandlingBranches(config: unknown): NodeBranch[] {
  return hasFailBranch(config) ? [{ id: 'fail', name: 'Fail', kind: 'fail' }] : []
}

/**
 * The declared outputs that survive on `handle`, for a node running under
 * `config`'s policy.
 *
 * The mirror of {@link errorHandlingBranches}: that one says which handles
 * exist, this one says what is on them, and both read the same
 * `error_strategy`, so the two can never disagree about a node.
 *
 * Applied by the CONSUMER — the picker and the ref checker — at the point where
 * it knows who is asking. `manifest.resolveOutputs` keeps returning the union
 * across all handles, unchanged: adding a `handle` parameter there would break
 * the `nodeId`-keyed memoization in `resolveInTopoOrder` and the
 * one-contract-two-orchestrations property the parity suite rests on.
 *
 * @param nodeId the consumer-visible node id, i.e. the `<nodeId>.` prefix on
 *   every declared variable id
 * @param declared what `resolveOutputs` returned — the union across handles
 */
export function scopeOutputsToHandle(
  errorHandling: NodeErrorHandling | undefined,
  config: unknown,
  nodeId: string,
  handle: string,
  declared: UnifiedVariable[]
): UnifiedVariable[] {
  if (!errorHandling) return declared

  const prefix = `${nodeId}.`
  const key = (v: UnifiedVariable) => (v.id.startsWith(prefix) ? v.id.slice(prefix.length) : v.id)

  // The failure door: only what the failure path writes.
  if (isErrorLikeHandle(handle)) {
    if (!errorHandling.failOutputs) return declared
    const keep = new Set(errorHandling.failOutputs)
    return declared.filter((v) => keep.has(key(v)))
  }

  // `source` under `fail`: the failure left by another door, so the
  // failure-only keys are provably absent here. crud writes them as an explicit
  // `null` on success, and `null` takes the same interpolation miss branch as
  // `undefined` — a WARN and an empty string — so offering them is offering a
  // variable whose only possible value is a logged warning.
  //
  // Under `continue` / `default` the failure lands on THIS handle. Nothing is
  // subtracted, and that asymmetry is the whole reason this reads the policy
  // rather than the handle alone.
  if (
    errorHandling.failureOnlyOutputs?.length &&
    normalizeErrorStrategy(
      (config as { error_strategy?: unknown } | undefined)?.error_strategy,
      errorHandling.defaultStrategy
    ) === ErrorStrategy.fail
  ) {
    const drop = new Set(errorHandling.failureOnlyOutputs)
    return declared.filter((v) => !drop.has(key(v)))
  }

  return declared
}

/**
 * The persisted `error_strategy` field, for a node type's `configSchema`.
 *
 * Narrower than the `z.string()` `http` shipped with (plan 21 §20.2): an
 * unrecognised string is a config bug, and letting one through means the panel
 * renders an empty `<Select>` while the processor silently runs the `fail` arm.
 *
 * `'none'` is accepted because persisted http configs carry it — it is the
 * legacy spelling of `continue` ({@link LEGACY_ALIASES}) — so a stored graph
 * must still parse. It is never written again; every reader resolves it with
 * {@link normalizeErrorStrategy}, which is why this stays a plain union rather
 * than a `.transform()`: `configSchema` is the *shape* contract, and rewriting
 * a value during validation would make the parsed config disagree with the row.
 *
 * Types opting in after http/crud use `errorStrategySchema.optional()`: no
 * existing row of theirs carries the key, and an absent value is what
 * {@link hasFailBranch} needs to see to render no branch.
 */
export const errorStrategySchema = z.union([z.enum(ErrorStrategy), z.literal('none')])

/**
 * A substitute value applied when the policy is `default` — `{ key, type,
 * value }`, where `value` is a string representation parsed per `type` and may
 * carry `{{…}}` refs.
 *
 * Declared here because two node types already ship the identical shape under
 * two names (`http.default_value`, `crud.default_values`). The KEYS are not
 * unified — that rename is plan 24's — but a third type does not get to invent
 * a third item shape.
 */
export const errorDefaultValueSchema = z.object({
  key: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  value: z.string(),
})

/** A substitute value applied when the policy is `default`. */
export type ErrorDefaultValue = z.infer<typeof errorDefaultValueSchema>

/**
 * Coerce a substitute's string form to the value the `default` policy
 * publishes.
 *
 * ONE implementation. This switch existed three times — `http`'s
 * `processDefaultValues`, `crud`'s, and `ai-v2`'s `resolveDefaultValues` — as
 * byte-identical copies (plan 24 §9.6), which is three places for a coercion
 * rule to drift.
 *
 * `value` arrives already interpolated: every call site resolves `{{…}}` refs
 * first, and they do it with different interpolators (`processText` vs
 * `interpolateVariables`), so the shared part is the coercion and not the
 * loop around it.
 *
 * The lossy edges are deliberately PRESERVED rather than fixed here, because
 * changing them is a run-time behaviour change on a failure path and this
 * refactor is not the place for it:
 *
 * - `number`: `parseFloat('abc') || 0` → `0`. Also turns a legitimate `'0'`
 *   into `0` via the `||`, which is harmless only because the result is the
 *   same.
 * - `boolean`: anything but `'true'` is `false`.
 * - `object`/`array`: unparseable JSON keeps the raw string, so a field typed
 *   `object` can hold a `string`.
 *
 * The closed key set is what makes these survivable: a substitute now targets
 * a DECLARED output whose `BaseType` the editor shows, so the author can see
 * the type they are writing into. Reporting the coercion misses is plan 24's
 * §9.6 follow-up, tracked as a defect rather than fixed silently.
 */
export function coerceDefaultValue(type: ErrorDefaultValue['type'], value: string): unknown {
  switch (type) {
    case 'number':
      return parseFloat(value) || 0
    case 'boolean':
      return value.toLowerCase() === 'true'
    case 'object':
    case 'array':
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    default:
      return value
  }
}

/**
 * The declared outputs a `default` substitute may target, given what the
 * node's resolver returned.
 *
 * This is the whole of plan 24's O5 decision — a CLOSED key set — in one
 * function. Before it, `default_values[].key` was free text, so a configured
 * key was written to the namespace, was NOT offered by the picker (it is not
 * in `resolveOutputs`), and any downstream ref to it was REJECTED by
 * `ref-check` (§9.5). The feature produced values you were not allowed to use,
 * and the resulting drift had to be pinned as correct-by-design in
 * `parity/known-broken.ts`. Drawing keys from the declaration retires all
 * three problems at once, and mechanically fixes §9.1 as a side effect:
 * http's "Status Code" control writes `status` because `status` is what the
 * manifest declares, not `status_code`.
 *
 * DEPTH RULE. A target is either a top-level path (`status`, `id`, `record`)
 * or one level inside the record tree (`<entityDefId>.name`) — the latter is
 * what makes "if the create fails, pretend it made this record" expressible.
 * Nothing deeper: crud declares its record tree at `maxDepth: 2`, and "pick
 * any of sixty field paths and type a substitute" is not an editor anyone
 * wants (§10.2).
 *
 * The two-segment arm is gated on the parent being a declared OBJECT, so a
 * flat node like http can never accidentally grow nested targets.
 *
 * @param declared what `resolveOutputs` returned — ids carry the `<nodeId>.` prefix
 * @param nodeId the prefix to strip
 * @param errorHandling the manifest's declaration, for {@link NodeErrorHandling.defaultValueExclude}
 * @returns the offerable targets, each carrying the node-relative `path` its
 *   `default_values[].key` must equal
 */
export function defaultValueTargets(
  declared: UnifiedVariable[],
  nodeId: string,
  errorHandling?: NodeErrorHandling
): Array<{ path: string; variable: UnifiedVariable }> {
  const prefix = `${nodeId}.`
  const exclude = new Set(errorHandling?.defaultValueExclude ?? [])
  const targets: Array<{ path: string; variable: UnifiedVariable }> = []

  const walk = (variable: UnifiedVariable, depth: number, parentPath: string): void => {
    const path = variable.id.startsWith(prefix) ? variable.id.slice(prefix.length) : variable.id
    if (exclude.has(path)) return

    // Depth 0 is always offerable. Depth 1 only under an object parent — the
    // record tree — which is the "pretend it made this record" case.
    if (depth === 0 || (depth === 1 && parentPath !== '')) {
      targets.push({ path, variable })
    }

    if (depth >= 1) return
    for (const child of Object.values(variable.properties ?? {})) {
      walk(child, depth + 1, path)
    }
  }

  for (const variable of declared) {
    walk(variable, 0, '')
  }

  return targets
}

/**
 * Validate a node's `default_values` against its declared targets.
 *
 * Shared so the panel, `validate_workflow` and the mutation result all say the
 * same thing — the three surfaces that were silent about the same defect
 * (§9.2). Returns `NodeValidationResult`-shaped entries for a manifest
 * `validate` to splice into its own list.
 *
 * Two findings:
 *
 * 1. **`default` with an empty list is a WARNING, not an error.** Every
 *    processor's `default` arm is guarded on a non-empty list and otherwise
 *    falls straight through to the fail arm, with no log and nothing in the
 *    panel — so the strategy silently does nothing. It is a warning rather
 *    than an error because the node still RUNS; it just runs as `fail`, which
 *    is a coherent (if unintended) workflow.
 * 2. **A key that is not a declared target is an ERROR.** Under the closed key
 *    set this can only come from a row persisted before the migration, and it
 *    writes to a path nothing downstream can read.
 *
 * Deliberately NOT `blocksAuthoring`: a legacy key is a pre-existing config
 * defect, and blocking the write would make a drifted node uneditable — the
 * exact trap `catalog/types.ts` documents on that flag.
 */
export function validateDefaultValues(params: {
  strategy: ErrorStrategy
  values: ErrorDefaultValue[] | undefined
  /** Offerable targets, or `undefined` when they cannot be resolved (no resource picked yet). */
  targets: Array<{ path: string }> | undefined
  /** Config key to report against — `default_values` everywhere after the rename. */
  field?: string
}): Array<{ field: string; message: string; type: 'warning' | 'error' }> {
  const { strategy, values, targets, field = 'default_values' } = params
  if (strategy !== ErrorStrategy.default) return []

  const rows = values ?? []
  if (rows.length === 0) {
    return [
      {
        field,
        message:
          'No substitutes configured, so this policy does nothing — the node will still fail. ' +
          'Add a default value, or switch the policy to Fail branch.',
        type: 'warning',
      },
    ]
  }

  // `undefined` targets means "cannot tell yet" (crud with no resource
  // picked), which must not be reported as "every key is wrong".
  if (!targets) return []

  const known = new Set(targets.map((t) => t.path))
  return rows
    .filter((row) => row.key && !known.has(row.key))
    .map((row) => ({
      field,
      message:
        `"${row.key}" is not one of this node's outputs, so nothing downstream can read it. ` +
        'Pick an output from the list, or remove the row.',
      type: 'error' as const,
    }))
}

/**
 * A node's configured substitutes, tolerating http's legacy singular key.
 *
 * `http` shipped `default_value`; `crud` and `ai` shipped `default_values`.
 * Plan 24 §10.4 unifies on the plural — it is an array, and crud's schema was
 * the rigorous one — and this is the read tolerance that keeps stored http
 * graphs working until the migration rewrites them.
 *
 * Exactly the shape of {@link LEGACY_ALIASES} for `'none'`, and it retires the
 * same way: plan 21 §19.1's point is that a tolerance is a migration scaffold,
 * so DELETE this together with the `default_value` key once plan 21 §19's
 * single pass has run everywhere.
 */
export function readDefaultValues(config: unknown): ErrorDefaultValue[] {
  const data = config as
    | { default_values?: ErrorDefaultValue[]; default_value?: ErrorDefaultValue[] }
    | undefined
  return data?.default_values ?? data?.default_value ?? []
}
