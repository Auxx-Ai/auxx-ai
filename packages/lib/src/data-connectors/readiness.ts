// packages/lib/src/data-connectors/readiness.ts
// Pure, client-safe readiness predicate for a connector's sync actions
// (v3/sync-action-readiness-guards §1). No DB, no server-only deps — both the
// server tRPC guard (committed rows) and the editor draft selector consume it.

import type { DataConnectorConfig } from './types'

/**
 * Why a connector can't sync/sample yet — ordered most-actionable first, so
 * `problems[0]` is the hint to surface in a tooltip / error message.
 */
export type ReadinessProblem =
  | 'disconnected' // the app behind the connector was uninstalled (task 44 D-6)
  | 'removing' // teardown in flight — the row survives only as the chain's anchor
  | 'no-endpoint' // no base URL (generic-rest) / no bound connection (app)
  | 'no-stream' // no enabled stream at all
  | 'stream-no-path' // best stream missing requestConfig.path
  | 'stream-no-schema' // best stream missing sourceSchema
  | 'no-mapping' // best stream has no targeted mapping with a field mapping

/** Result of {@link getConnectorReadiness}. `problems` empty ⇔ `canSync` true. */
export interface ConnectorReadiness {
  /** Endpoint present — enough to run a Test fetch (discovers the schema). */
  canSample: boolean
  /** `canSample` AND ≥1 fully-configured enabled stream — enough to run a real sync. */
  canSync: boolean
  /** Ordered; `problems[0]` is the most actionable hint. Empty when `canSync`. */
  problems: ReadinessProblem[]
}

/**
 * Minimal structural stream shape the predicate reads. Both the server's raw
 * `StreamWithRawMappings` rows and a future UI draft satisfy this — keep it to
 * the named fields the predicate touches.
 */
export interface ReadinessStream {
  enabled: boolean
  sourceSchema: Record<string, unknown> | null
  requestConfig: { path?: string } | null
  mappings: { entityDefinitionId: string | null; fieldMappings: unknown[] | null }[]
}

/** Human-readable hint per problem — tooltip text + server error message. */
export const READINESS_REASON = {
  disconnected: 'Reinstall the app to resume syncing',
  removing: 'Removing this connector',
  'no-endpoint': 'Add a base URL',
  'no-stream': 'Add a stream',
  'stream-no-path': 'Add a request path to the stream',
  'stream-no-schema': 'Add a schema to the stream (run Test fetch)',
  'no-mapping': 'Map at least one field',
} as const satisfies Record<ReadinessProblem, string>

/** A non-empty source schema = at least one declared key. */
function hasSchema(schema: Record<string, unknown> | null): boolean {
  return !!schema && Object.keys(schema).length > 0
}

/** A stream is targeted when ≥1 mapping has a def AND at least one field mapping. */
function hasTargetedMapping(mappings: ReadinessStream['mappings']): boolean {
  return mappings.some((m) => m.entityDefinitionId !== null && (m.fieldMappings?.length ?? 0) >= 1)
}

// Failure steps for an enabled stream, ordered path → schema → mapping. The index
// doubles as a "how close to complete" rank when picking the best stream.
const STREAM_STEPS = ['stream-no-path', 'stream-no-schema', 'no-mapping'] as const

/**
 * First failing step of an enabled stream, in order path → schema → mapping, or
 * `null` when fully configured. `requirePath` is false for app connectors (their
 * fetch is fixed — no request path to author). A stream needs no user-facing name
 * to sync — its stable `streamId` is the functional key (see slice-orchestrator).
 */
function firstStreamFailure(
  stream: ReadinessStream,
  requirePath: boolean
): (typeof STREAM_STEPS)[number] | null {
  if (requirePath && !stream.requestConfig?.path) return 'stream-no-path'
  if (!hasSchema(stream.sourceSchema)) return 'stream-no-schema'
  if (!hasTargetedMapping(stream.mappings)) return 'no-mapping'
  return null
}

/**
 * Compute a connector's sync-action readiness from its lifecycle status and its
 * committed/draft config.
 *
 * - A `disconnected` or `deleting` connector refuses everything, whatever the config
 *   says (task 44 §7.11 / D-6). This is FIRST because it is not a config problem and
 *   no amount of authoring fixes it — see the block comment on the check itself.
 * - `canSample` = endpoint present (generic-rest: `config.endpoint.baseUrl`;
 *   app connector: a bound `credentialId`). Enough for a Test fetch.
 * - `canSync` = `canSample` AND ≥1 ENABLED, fully-configured stream (a request
 *   path for generic-rest, a non-empty `sourceSchema`, and a targeted mapping
 *   with ≥1 field mapping — no user-facing name required). At least one — never
 *   every — stream, so a connector mid-build of a second stream still syncs the first.
 *
 * Pure: reads only the named fields, no DB. `problems[0]` is the actionable hint.
 */
export function getConnectorReadiness(
  connector: {
    /** `DataConnector.status`. Widened to string — the enum lives server-side. */
    status: string
    definitionKind: string
    config: DataConnectorConfig | null
    credentialId: string | null
  },
  streams: ReadinessStream[]
): ConnectorReadiness {
  // 🛑 Lifecycle refusals come BEFORE the config checks, and they are the whole
  // point of this block (task 44 §7.11). Uninstalling an app deliberately PRESERVES
  // the credential, so a `disconnected` app connector still satisfies `canSample`
  // and, with its streams intact, `canSync` — every structural check below passes
  // and the manual door waves it through. That is not academic: one "Sync now" click
  // moved a disconnected connector to `error`, which discarded the Disconnected
  // banner AND put it outside `reconnectConnectorsForInstallation`'s
  // `status = 'disconnected'` scope, so reinstalling the app no longer repaired it.
  //
  // ⚠️ `paused` is deliberately NOT here. A merchant who paused a connector and then
  // presses Sync now plausibly means it, and they can resume it themselves.
  // `disconnected` is different: they cannot make it work from here, and the click
  // silently discards a state they cannot get back.
  if (connector.status === 'disconnected') {
    return { canSample: false, canSync: false, problems: ['disconnected'] }
  }
  if (connector.status === 'deleting') {
    return { canSample: false, canSync: false, problems: ['removing'] }
  }

  const isApp = connector.definitionKind === 'app'
  const canSample = isApp
    ? !!connector.credentialId
    : typeof connector.config?.endpoint?.baseUrl === 'string' &&
      connector.config.endpoint.baseUrl.length > 0

  if (!canSample) {
    return { canSample: false, canSync: false, problems: ['no-endpoint'] }
  }

  const enabled = streams.filter((s) => s.enabled)
  if (enabled.length === 0) {
    return { canSample: true, canSync: false, problems: ['no-stream'] }
  }

  // canSync needs at least one fully-configured stream.
  const failures = enabled.map((s) => firstStreamFailure(s, !isApp))
  if (failures.some((f) => f === null)) {
    return { canSample: true, canSync: true, problems: [] }
  }

  // No stream is complete — report the first failing reason of the stream that
  // got the furthest (highest step rank).
  let best = failures[0] as (typeof STREAM_STEPS)[number]
  for (const f of failures) {
    if (f && STREAM_STEPS.indexOf(f) > STREAM_STEPS.indexOf(best)) best = f
  }
  return { canSample: true, canSync: false, problems: [best] }
}
