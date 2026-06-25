// apps/web/src/components/data-connectors/lib/resolve-sync-status.ts
// The pure, client-safe status resolver (Step 9 §3.2). Maps the raw connector
// lifecycle status + its latest run onto the freshness-first vocabulary the status
// line / list card / detail pill all render: Synced · Syncing · Rate-limited ·
// Paused · Action needed · Error (+ Idle for a not-yet-configured source). Two of
// the live states are DERIVED, not raw enum values:
//   • Rate-limited = syncing AND the run's `rateLimited.until` is set + in the future.
//   • Action needed = error AND the message classifies as an auth/connection failure
//     (reconnect) vs. a generic retryable Error.
// No server imports, no time-relative formatting — freshness ("4 min ago", the live
// "0:28" countdown) is composed by the component from `countdownUntil` + the status
// payload's lastSyncedAt/nextSyncAt. Keep this dependency-light so it can't pull a
// server-only module into a client bundle (CLAUDE.md client rule).

import type { ConnectorStatus, RunStatus } from '../ui/connector-status'

/**
 * The resolved status vocabulary. The first six are the plan's live states; `idle`
 * covers a `pending` connector (no mappings / never synced) so it isn't miscolored
 * as one of the active states.
 */
export type SyncStatusState =
  | 'synced'
  | 'syncing'
  | 'rate-limited'
  | 'paused'
  | 'action-needed'
  | 'error'
  | 'idle'

/**
 * The header CTA the state implies. `pause` is included (the plan's §3.2 list omits
 * it, but the §10.1 mock shows [Pause] while syncing — the resolver is the source of
 * truth for which action a state offers).
 */
export type SyncPrimaryAction = 'sync' | 'pause' | 'resume' | 'reconnect' | 'retry'

/** The slice of the latest `DataConnectorRun` the resolver reads (from `getStatus`). */
export interface SyncStatusRunInfo {
  status: RunStatus
  /** Engine lifecycle phase; absent/null on legacy single-shot runs. */
  phase?: 'backfill' | 'steady' | null
  /** Live aggregate records-seen across the connector's streams (backfill counts). */
  recordsSeen?: number
  /** ISO time the next slice is throttled until, or null/absent when not rate-limited. */
  rateLimitedUntil?: string | null
  /**
   * Why the latest run parked (trial-sync / ingest-ceiling). `'sample'` flips the
   * paused state to the positive "Sample ready" reading; absent ⇒ a plain pause.
   */
  pausedReason?: string | null
  /** Per-run delta for the steady freshness line. */
  created?: number
  updated?: number
  /** The actively-importing stream's key (e.g. "orders"), for the backfill detail noun. */
  primaryStreamLabel?: string | null
}

export interface SyncStatusInput {
  status: ConnectorStatus
  /** The connector's last error message (free text — no code is persisted). */
  error?: string | null
  latestRun?: SyncStatusRunInfo | null
}

export interface ResolvedSyncStatus {
  state: SyncStatusState
  /** Short label for the pill/dot ("Syncing", "Action needed"). */
  label: string
  /** One-line description WITHOUT relative time (counts + static copy only). */
  detail: string
  /** ISO instant a live countdown ticks toward ("retrying in 0:28"); rate-limited only. */
  countdownUntil?: string
  primaryAction?: SyncPrimaryAction
}

// Auth/connection failures the user must act on (reconnect) vs. a generic retryable
// error. We only have the persisted message string to go on, so match the common
// shapes AuxxError messages and provider 401/403s produce.
const AUTH_ERROR_HINTS =
  /\b(unauthor|forbidden|401|403|invalid[\s_-]*(token|credential|api[\s_-]*key)|token[\s_-]*expired|expired[\s_-]*token|reconnect|authentication|permission[\s_-]*denied|access[\s_-]*denied|credential)\b/i

/** Classify a connector error message into the "reconnect" vs. "retry" bucket. */
export function classifyConnectorError(error?: string | null): 'auth' | 'generic' {
  return error && AUTH_ERROR_HINTS.test(error) ? 'auth' : 'generic'
}

/**
 * Resolve the connector's display status. Pure — pass `now` (ms) to make the
 * rate-limited countdown deterministic in tests; defaults to `Date.now()`.
 */
export function resolveSyncStatus(
  input: SyncStatusInput,
  now: number = Date.now()
): ResolvedSyncStatus {
  const { status, error, latestRun } = input

  if (status === 'pending') {
    return {
      state: 'idle',
      label: 'Not set up',
      detail: 'Add a source and field mappings to start syncing.',
      primaryAction: 'sync',
    }
  }

  if (status === 'ready') {
    // Configured via "Finish without syncing" — idle, never synced, scheduler-eligible.
    // Reuses the `idle` coloring path; only the label/detail differ from `pending`.
    return {
      state: 'idle',
      label: 'Ready',
      detail: 'Set up — not synced yet. Sync now, or wait for the schedule.',
      primaryAction: 'sync',
    }
  }

  if (status === 'paused') {
    // A sample park is a positive, voluntary stop (trial-sync §6) — read it as "ready
    // for review", offering "Sync everything" (a full sync), not a plain Resume.
    if (latestRun?.pausedReason === 'sample') {
      return {
        state: 'paused',
        label: 'Sample ready',
        detail: 'Sample imported — review it, then sync everything.',
        primaryAction: 'sync',
      }
    }
    return {
      state: 'paused',
      label: 'Paused',
      detail: 'Syncing is paused.',
      primaryAction: 'resume',
    }
  }

  if (status === 'error') {
    if (classifyConnectorError(error) === 'auth') {
      return {
        state: 'action-needed',
        label: 'Action needed',
        detail: 'Reconnect the source — the connection expired.',
        primaryAction: 'reconnect',
      }
    }
    return {
      state: 'error',
      label: 'Error',
      // Static copy only — the raw (often long, technical) error message is surfaced
      // separately behind a tooltip in the status line, not dumped into the header.
      detail: 'Last sync failed.',
      primaryAction: 'retry',
    }
  }

  if (status === 'syncing' || status === 'provisioning') {
    // Rate-limited is derived: a throttled slice stamped `rateLimited.until` in the
    // future. Once it passes (the next slice ran), fall through to plain syncing.
    const until = latestRun?.rateLimitedUntil
    if (until && new Date(until).getTime() > now) {
      return {
        state: 'rate-limited',
        label: 'Rate-limited',
        detail: 'Waiting for the source — too many requests. Auto-resumes.',
        countdownUntil: until,
        // No CTA: it self-heals. (Pause is still available elsewhere on the page.)
      }
    }

    const records = latestRun?.recordsSeen ?? 0
    // "records so far" is a backfill concept; steady deltas use the run +n/+n line.
    const isBackfill = !latestRun || latestRun.phase !== 'steady'
    const noun = latestRun?.primaryStreamLabel?.trim() || 'records'
    const detail =
      isBackfill && records > 0
        ? `Importing ${noun} — ${records.toLocaleString()} records so far`
        : 'Syncing…'
    return {
      state: 'syncing',
      label: status === 'provisioning' ? 'Provisioning' : 'Syncing',
      detail,
      primaryAction: 'pause',
    }
  }

  // status === 'live' → Synced. Detail carries the per-run delta when there was one;
  // freshness ("last synced 4 min ago · next in 11 min") is composed by the component.
  const created = latestRun?.created ?? 0
  const updated = latestRun?.updated ?? 0
  const detail =
    created > 0 || updated > 0 ? `Last run: +${updated} updated, +${created} new` : 'Up to date.'
  return { state: 'synced', label: 'Synced', detail, primaryAction: 'sync' }
}
