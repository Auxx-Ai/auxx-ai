// packages/lib/src/data-connectors/refresh-outcome.ts
// Browser-safe: what the record drawer's refresh button says about its run (v13 §4).

/** The run fields the refresh line reads. */
export interface RefreshRunSummary {
  status: string
  created: number
  updated: number
  skipped: number
  errorSample: Array<{ externalId: string; error: string }> | null
}

export type RecordRefreshOutcome =
  | { state: 'waiting' }
  | { state: 'running' }
  | { state: 'done'; tone: 'success' | 'neutral' | 'error'; message: string }

const MAX_MESSAGE = 160

/** Map a refresh's run row (null until the job opens it) to the line shown next to the button. */
export function describeRecordRefresh(
  run: RefreshRunSummary | null,
  sourceName: string
): RecordRefreshOutcome {
  if (!run) return { state: 'waiting' }
  if (run.status === 'running') return { state: 'running' }

  if (run.status !== 'completed') {
    const error = run.errorSample?.find((e) => !e.externalId) ?? run.errorSample?.[0]
    return { state: 'done', tone: 'error', message: shorten(error?.error ?? 'The refresh failed.') }
  }
  if (run.updated + run.created > 0) return { state: 'done', tone: 'success', message: 'Updated' }
  if (run.skipped > 0) return { state: 'done', tone: 'neutral', message: 'Unchanged' }
  return { state: 'done', tone: 'neutral', message: `Not found in ${sourceName}` }
}

function shorten(message: string): string {
  return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message
}
