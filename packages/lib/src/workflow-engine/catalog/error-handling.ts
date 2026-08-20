// packages/lib/src/workflow-engine/catalog/error-handling.ts

import { z } from 'zod'
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
  /** Succeed anyway, stay on `source`, carry the error in the output. */
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

/** A node type's declared failure-policy support, hung off its `NodeManifest`. */
export interface NodeErrorHandling {
  /** Which policies this type supports — a subset of fail | continue | default. */
  strategies: ErrorStrategy[]
  /** What an unconfigured node does. */
  defaultStrategy: ErrorStrategy
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
