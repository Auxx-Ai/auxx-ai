// packages/lib/src/data-connectors/async-export/types.ts
// The provider-neutral async bulk-export seam (Step 7 / large-dataset-sync §5).
// Some APIs (Shopify Bulk Operations, Salesforce Bulk API 2.0) don't paginate large
// reads — you submit a query, they run it ASYNC on their side, and hand back a single
// result file. We model that as a connector capability whose "slice" is a phase of the
// job (initiate → poll → download), NOT a page of records — so polling re-enqueues a
// continuation slice instead of blocking a worker lock for minutes. The driver below
// is the only provider-specific piece; the state machine (`runAsyncExportSlice`) and
// the `__parentId` restitch helper are shared and provider-neutral.

import type { RuntimeConnectionData } from '../../connections/resolve-connection-for-runtime'
import type { SyncCursor } from '../../sync-core/contracts'
import type { ConnectorRecord, DataConnectorConfig, StreamRequestConfig } from '../types'

/** Where one async export job is in its lifecycle, carried across slices. */
export interface AsyncExportState {
  stage: 'init' | 'poll' | 'download'
  /** Opaque provider handle for the running job (Shopify bulk operation id). */
  handle?: string
  /** Signed result-file URL, set once the job reports COMPLETED. */
  url?: string
  /** Re-initiate count (a FAILED/EXPIRED job is retried up to {@link MAX_REINITIATE}). */
  attempts?: number
  /** Poll count — drives the capped poll backoff so a long job isn't polled every 5s forever. */
  polls?: number
}

/** A provider's report of the job's current status (polled each slice). */
export type AsyncExportStatus =
  | { state: 'running' }
  | { state: 'completed'; url: string }
  /** Transient — the job failed; re-initiate (bounded). `reason` is surfaced on permanent give-up. */
  | { state: 'failed'; reason?: string }
  /** The result URL expired (7-day deadline) before download — re-initiate. */
  | { state: 'expired' }

/** Inputs a capability needs to build a provider driver for one stream's export. */
export interface AsyncExportArgs {
  streamKey: string
  credential: RuntimeConnectionData | null
  config: DataConnectorConfig
  requestConfig?: StreamRequestConfig
}

/**
 * The one provider-specific piece. Implementations (Shopify Bulk Ops — Step 7b) own
 * the API I/O: kick off the job, report status, and stream the completed file as
 * already-restitched {@link ConnectorRecord}s (the driver uses the shared
 * `restitchByParentId` helper to re-nest the flat JSONL). Everything else — the slice
 * state machine, re-initiate, checkpointing — is provider-neutral.
 */
export interface AsyncExportDriver {
  readonly id: string
  /** Kick off the async job; return the opaque handle to poll. */
  initiate(): Promise<{ handle: string }>
  /** Check the job's status by handle. */
  poll(handle: string): Promise<AsyncExportStatus>
  /** Stream the completed export as fully-formed, restitched records (lazy). */
  download(url: string): AsyncIterable<ConnectorRecord>
}

/** A connector definition's optional async bulk-export capability. */
export interface AsyncExportCapability {
  createDriver(args: AsyncExportArgs): AsyncExportDriver
}

// ── Tuning ──────────────────────────────────────────────────────────────────────

/** First poll delay; doubles each poll up to {@link POLL_MAX_MS}. */
export const POLL_BASE_MS = 5_000
/** Poll-delay ceiling — a long-running export is polled at most this often. */
export const POLL_MAX_MS = 60_000
/** Re-initiate budget for a FAILED/EXPIRED job before the run is failed permanently. */
export const MAX_REINITIATE = 3

/** Capped exponential poll backoff: 5s, 10s, 20s, 40s, 60s, 60s… */
export function pollDelayMs(polls: number): number {
  return Math.min(POLL_BASE_MS * 2 ** Math.max(0, polls), POLL_MAX_MS)
}

// ── Cursor codec ──────────────────────────────────────────────────────────────────
// The async state rides the core's opaque `SyncCursor` (checkpointed by the
// SyncStateStore, resumed each slice) — the core never interprets it, so we keep the
// whole state machine inside the connector layer (no sync-core change).

/** Encode the async-export state as the slice's resume cursor. */
export function encodeAsyncCursor(state: AsyncExportState): SyncCursor {
  return { kind: 'token', value: JSON.stringify(state) }
}

/** Decode the slice's resume cursor back to async-export state; absent/garbage ⇒ start at `init`. */
export function decodeAsyncCursor(cursor?: SyncCursor): AsyncExportState {
  if (!cursor?.value) return { stage: 'init' }
  try {
    const parsed = JSON.parse(cursor.value) as AsyncExportState
    return parsed.stage ? parsed : { stage: 'init' }
  } catch {
    return { stage: 'init' }
  }
}
