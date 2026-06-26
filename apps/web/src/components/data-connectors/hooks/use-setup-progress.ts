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
  /** Connect is satisfied — gating only (the Continue button). */
  connect: boolean
  /**
   * Connect has genuinely nothing to do (app connector with no required connection AND
   * no config form). Only then is it safe to auto-skip the step instead of opening on
   * it — a credential to bind or any config field (required or not) keeps the user here.
   */
  connectTrivial: boolean
  /** At least one stream has a source schema (a successful sample → "use as schema"). */
  sample: boolean
  /** EVERY stream is `ready` (≥1 mapping with a bound `targetFieldRef`). */
  map: boolean
  /** Map satisfied → the terminal "Run first sync" CTA is enabled
   *  (Sample is implied by Map; Schedule defaults to Manual). */
  canRun: boolean
}

/** App-connector Connect requirements — the stepper resolves these from the apps
 *  context + the connector's declared config schema (not available to a pure
 *  connector+streams read), then hands them in. Ignored for generic-rest. */
export interface ConnectRequirements {
  /** The app exposes a connection definition ⇒ a bound credential is required. */
  requiresConnection: boolean
  /** The connector declares ≥1 config field (required or optional). */
  hasConfigForm: boolean
  /** Every *required* config field has a value. */
  requiredConfigSatisfied: boolean
}

/**
 * Derive each setup step's "done" state from the connector + its streams — no new
 * `step` column, no client wizard state. Every predicate reads persisted data the
 * detail view already queries (`getById` + `listStreams`). See plan §2.2.
 */
export function deriveSetupProgress(
  connector: Connector,
  streams: Stream[],
  connectReqs: ConnectRequirements
): SetupProgress {
  const isGenericRest = connector.definitionKind !== 'app'

  let connect: boolean
  let connectTrivial: boolean
  if (isGenericRest) {
    // Generic-rest: the connection itself is optional, but it still needs an endpoint
    // base URL to fetch from. Never trivial — it always has the endpoint form to fill.
    const baseUrl = (connector.config as { endpoint?: { baseUrl?: string } } | null)?.endpoint
      ?.baseUrl
    connect = !!baseUrl?.trim()
    connectTrivial = false
  } else {
    // App connector: the catalog supplies the endpoint, but the connection still has to
    // be authorized and any declared settings still have to be set. Only auto-skip when
    // there's nothing to authorize AND nothing to configure.
    const { requiresConnection, hasConfigForm, requiredConfigSatisfied } = connectReqs
    connectTrivial = !requiresConnection && !hasConfigForm
    connect =
      connectTrivial ||
      ((!requiresConnection || !!connector.credentialId) && requiredConfigSatisfied)
  }

  const sample = streams.some((s) => s.sourceSchema != null)
  // Every stream must be mapped — an app connector that fans out to N streams (or
  // carries a draft contributing mapping) can't finish setup with a half-authored
  // fan-out (multi-stream-setup-plan §4.2).
  const map = streams.length > 0 && streams.every((s) => deriveStreamReadiness(s) === 'ready')
  return { connect, connectTrivial, sample, map, canRun: map }
}
