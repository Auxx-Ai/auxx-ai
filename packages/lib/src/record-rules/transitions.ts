// packages/lib/src/record-rules/transitions.ts
// Old→new transition matching for field rules. Direction semantics live here — the
// condition evaluator sees one record snapshot and cannot express old→new comparisons.

import { isEmpty } from '@auxx/utils/objects'
import type { RecordRuleOn } from './types'

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return String(a) === String(b)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Does an old→new field write satisfy the rule's `on` transition?
 * Lifecycle transitions (`created`/`deleted`) never match here — they dispatch
 * from the bus, not the field-hook seam.
 */
export function matchesFieldTransition(on: RecordRuleOn, oldValue: unknown, newValue: unknown) {
  switch (on) {
    case 'changed':
      return !valuesEqual(oldValue, newValue)
    case 'increased': {
      const prev = asNumber(oldValue)
      const next = asNumber(newValue)
      return prev !== null && next !== null && next > prev
    }
    case 'decreased': {
      const prev = asNumber(oldValue)
      const next = asNumber(newValue)
      return prev !== null && next !== null && next < prev
    }
    case 'set':
      return isEmpty(oldValue) && !isEmpty(newValue)
    case 'cleared':
      return !isEmpty(oldValue) && isEmpty(newValue)
    case 'created':
    case 'deleted':
      return false
  }
}
