// apps/web/src/components/data-connectors/hooks/use-setup-progress.ts
'use client'

import type { RouterOutputs } from '~/trpc/react'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

/** The setup stepper's ordered steps (create-sync-flow-plan §2.1). */
export type SetupStepId = 'connect' | 'sample' | 'map' | 'schedule' | 'run'

/** Per-stream mapping readiness, surfaced as a badge in the multi-stream overview. */
export type StreamReadiness = 'ready' | 'needs-mapping'

/**
 * A stream is ready once it has ≥1 mapping with a bound `targetFieldRef`. A row with
 * zero bound bindings (a freshly materialized draft — owned never is, a contributing
 * default-mapping is until authored) needs attention (multi-stream-setup-plan §4.1).
 */
export function deriveStreamReadiness(stream: Stream): StreamReadiness {
  const bound = stream.mappings.some((m) =>
    m.fieldMappings?.some((fm) => fm.targetFieldRef != null)
  )
  return bound ? 'ready' : 'needs-mapping'
}

export interface SetupProgress {
  /** A credential is bound, or the endpoint declares no auth. */
  connect: boolean
  /** At least one stream has a source schema (a successful sample → "use as schema"). */
  sample: boolean
  /** EVERY stream is `ready` (≥1 mapping with a bound `targetFieldRef`). */
  map: boolean
  /** Connect + Map satisfied → the terminal "Run first sync" CTA is enabled
   *  (Sample is implied by Map; Schedule defaults to Manual). */
  canRun: boolean
}

/**
 * Derive each setup step's "done" state from the connector + its streams — no new
 * `step` column, no client wizard state. Every predicate reads persisted data the
 * detail view already queries (`getById` + `listStreams`). See plan §2.2.
 */
export function deriveSetupProgress(connector: Connector, streams: Stream[]): SetupProgress {
  const auth = (connector.config as { endpoint?: { auth?: string } } | null)?.endpoint?.auth
  const connect = connector.credentialId != null || auth === 'none'
  const sample = streams.some((s) => s.sourceSchema != null)
  // Every stream must be mapped — an app connector that fans out to N streams (or
  // carries a draft contributing mapping) can't finish setup with a half-authored
  // fan-out (multi-stream-setup-plan §4.2).
  const map = streams.length > 0 && streams.every((s) => deriveStreamReadiness(s) === 'ready')
  return { connect, sample, map, canRun: connect && map }
}
