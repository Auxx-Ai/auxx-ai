// packages/lib/src/evals/comparators.ts
//
// Deterministic assertion comparison semantics, shared by the agent grader and
// (later) the workflow grader. Pure — no IO, no clock — so it's exhaustively
// unit-testable. See plans/evals/phase-1-agent-simulation.md §1.8 / build-plan
// "Comparator semantics".

import type { Comparator } from '@auxx/types/evals'
import { deepEqual } from '@auxx/utils/objects'
import { toNumeric } from '@auxx/utils/parse'

export type CompareOutcome = {
  passed: boolean
  /** Human-readable reason, surfaced on the AssertionResult when it fails or errors. */
  note?: string
}

/** Sentinel returned by field/variable resolvers when a value is genuinely absent. */
export const MISSING = Symbol('eval.missing')

const isPresent = (v: unknown) => v !== undefined && v !== MISSING

function containsCheck(actual: unknown, expected: unknown): CompareOutcome {
  if (typeof actual === 'string') {
    if (typeof expected !== 'string') {
      return { passed: false, note: 'contains: string actual requires a string expected' }
    }
    return { passed: actual.includes(expected) }
  }
  if (Array.isArray(actual)) {
    return { passed: actual.some((item) => deepEqual(item, expected)) }
  }
  return { passed: false, note: 'contains: actual is neither a string nor an array' }
}

/**
 * Evaluate one comparator against a resolved `actual` and optional `expected`.
 *
 * - `exists` / `not_exists` distinguish MISSING from `null` (a present `null`
 *   still "exists").
 * - `equals` / `not_equals` use {@link deepEqual}.
 * - `gt|gte|lt|lte` compare numerically, treating ISO date strings as epoch ms.
 *   `tolerance` loosens the boundary symmetrically (default 0).
 */
export function evaluateComparator(
  comparator: Comparator,
  actual: unknown,
  expected?: unknown
): CompareOutcome {
  switch (comparator.op) {
    case 'exists':
      return { passed: isPresent(actual) }
    case 'not_exists':
      return { passed: !isPresent(actual) }
    case 'equals':
      return { passed: deepEqual(actual, expected) }
    case 'not_equals':
      return { passed: !deepEqual(actual, expected) }
    case 'contains':
      return containsCheck(actual, expected)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumeric(actual)
      const e = toNumeric(expected)
      if (a === null || e === null) {
        return {
          passed: false,
          note: 'numeric/date comparator requires numeric or ISO-date values',
        }
      }
      const tol = comparator.tolerance ?? 0
      switch (comparator.op) {
        case 'gt':
          return { passed: a > e - tol }
        case 'gte':
          return { passed: a >= e - tol }
        case 'lt':
          return { passed: a < e + tol }
        case 'lte':
          return { passed: a <= e + tol }
      }
    }
  }
}
