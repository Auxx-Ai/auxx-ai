// packages/lib/src/data-connectors/run-counters.ts

import type { RunCounters } from './service'

/** One mapping's share of a run's write outcomes. */
// A type alias, not an interface, so it satisfies the sync-core counters' index signature.
export type MappingCounters = {
  created: number
  updated: number
  skipped: number
  failed: number
}

/** Bump a total and the same outcome under its mapping, together. */
export function countOutcome(
  counters: RunCounters,
  mappingId: string,
  outcome: keyof MappingCounters
): void {
  counters[outcome] += 1
  const m = (counters.byMapping[mappingId] ??= { created: 0, updated: 0, skipped: 0, failed: 0 })
  m[outcome] += 1
}
