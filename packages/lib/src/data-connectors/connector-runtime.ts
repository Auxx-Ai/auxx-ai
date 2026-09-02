// packages/lib/src/data-connectors/connector-runtime.ts
// The single seam that turns a DataConnector row into a runnable fetch: it
// resolves the connector definition (connectorFor) and the bound credential
// (the unified resolver — reveals + lazily refreshes the token, carries the
// definition's `authApply` spec). Both the scheduled sync (run-data-connector-
// sync) and the test-fetch (sampleConnectorFetch) go through `prepareConnectorFetch`
// so they can never diverge on auth — the bug class where a test-fetch 401s
// because it forgot to attach the credential the real sync attaches.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  type RuntimeConnectionData,
  resolveConnectionForRuntime,
} from '../connections/resolve-connection-for-runtime'
import { UnprocessableEntityError } from '../errors'
import { connectorFor } from './connectors'
import type {
  ConnectorRecord,
  ConnectorYield,
  DataConnectorDefinition,
  StreamRequestConfig,
} from './connectors/types'
import { isConnectorCheckpoint } from './connectors/types'
import { type DataConnectorRow, listStreams } from './service'

const logger = createScopedLogger('data-connector-runtime')

/**
 * Resolve the connector's borrowed credential through the unified resolver, or
 * null when none/failed. The resolver reveals + lazily refreshes the token and
 * carries the definition's `authApply` spec; the connector applies it via
 * `applyAuth`. A connector binds an org-scoped credential, but a per-user one is
 * accepted too (the resolver classifies scope by the credential's own userId).
 */
export async function resolveConnectorCredential(
  organizationId: string,
  credentialId: string | null,
  userId: string
): Promise<RuntimeConnectionData | null> {
  if (!credentialId) return null
  const resolved = await resolveConnectionForRuntime({
    connectionId: credentialId,
    organizationId,
    userId,
  })
  if (resolved.isErr()) {
    logger.warn('failed to resolve credential — proceeding without', {
      credentialId,
      error: resolved.error.code,
    })
    return null
  }
  return resolved.value.organizationConnection ?? resolved.value.userConnection ?? null
}

/** A connector resolved into everything its `fetch` needs except per-stream args. */
export interface PreparedConnectorFetch {
  definition: DataConnectorDefinition
  credential: RuntimeConnectionData | null
}

/**
 * Resolve a connector row into a runnable fetch: its definition + resolved
 * credential. The single place both the scheduled sync and the test-fetch build
 * their fetch from — keep all consumers on this so auth can't drift between them.
 *
 * App connectors fetch through the sandbox (the adapter resolves its own runtime
 * connection); built-ins ignore the context and use `credential`.
 */
export async function prepareConnectorFetch(
  db: Database,
  organizationId: string,
  connector: DataConnectorRow,
  userId: string
): Promise<PreparedConnectorFetch> {
  const definition = connectorFor(connector.type, {
    db,
    organizationId,
    connector: {
      id: connector.id,
      type: connector.type,
      credentialId: connector.credentialId,
      appInstallationId: connector.appInstallationId,
    },
  })
  const credential = await resolveConnectorCredential(
    organizationId,
    connector.credentialId,
    userId
  )
  return { definition, credential }
}

/** Input to a test-fetch — a stream's request shape before it's persisted. */
export interface SampleConnectorFetchInput {
  /** Omitted/null for a blank stream; generic-rest ignores it, apps derive it. */
  streamKey?: string | null
  /**
   * The per-stream request config being EDITED (generic-rest). Omit it and the
   * stream's persisted config is loaded instead — see `resolveRequestConfig`.
   */
  requestConfig?: StreamRequestConfig
}

/**
 * The request shape to sample with: the unsaved one the caller is editing, else the
 * stream's persisted config.
 *
 * The fallback is not an optimization. `generic-rest` builds its path from
 * `requestConfig` alone (`request.path ?? ''`), so a caller that passes none makes it
 * fetch the BARE base URL — a different request from the one the scheduled sync runs,
 * which is exactly the divergence this module exists to prevent. Template- and
 * catalog-seeded connectors hit that path: their request shape arrives at create time
 * and lives only on the stream row, so the Connect step's "Preview records" button
 * (which knows a `streamKey` and nothing else) sampled `https://host/v1` instead of
 * `https://host/v1/contacts`. App connectors are unaffected — their adapter derives its
 * own request from the stream key — and passing `requestConfig` explicitly still wins,
 * so the Sample step keeps previewing unsaved edits.
 */
async function resolveRequestConfig(
  db: Database,
  organizationId: string,
  connector: DataConnectorRow,
  input: SampleConnectorFetchInput
): Promise<StreamRequestConfig | undefined> {
  if (input.requestConfig) return input.requestConfig
  if (!input.streamKey) return undefined
  const streams = await listStreams(db, organizationId, connector.id)
  const stream = streams.find((s) => s.streamKey === input.streamKey)
  return (stream?.requestConfig as StreamRequestConfig | null) ?? undefined
}

/**
 * Response headers (lowercased keys) the test-fetch forwards to the client for
 * pagination detection. Allowlisted — we never dump the whole header bag to the
 * browser (avoids leaking rate-limit/infra headers). Extend as detection grows.
 */
const SAMPLE_HEADER_ALLOWLIST = ['link'] as const

/** The first raw page of a connector fetch, for schema inference + preview. */
export interface SampleConnectorFetchResult {
  response: unknown
  recordCount: number
  /** Allowlisted first-page response headers (lowercased keys); `link` for now. */
  responseHeaders?: Record<string, string>
}

/**
 * Run the connector's real fetch path against a (possibly unsaved) request
 * config and return the first raw page — the same definition + credential the
 * scheduled sync uses, stopping before mapping/sinking. Used by the builder's
 * test-fetch to infer schema and preview exactly what the source returns.
 */
export async function sampleConnectorFetch(
  db: Database,
  organizationId: string,
  userId: string,
  connector: DataConnectorRow,
  input: SampleConnectorFetchInput
): Promise<SampleConnectorFetchResult> {
  const { definition, credential } = await prepareConnectorFetch(
    db,
    organizationId,
    connector,
    userId
  )
  const requestConfig = await resolveRequestConfig(db, organizationId, connector, input)
  // Capture the first page's headers via the opt-in callback (closure). `fetch` is
  // a lazy generator, so the loop runs past the transport call + `onPageMeta`
  // before the first record reaches the `for await` below — `firstHeaders` is set
  // by the time we read it.
  let firstHeaders: Record<string, string> | undefined
  const { records } = await definition.fetch({
    streamKey: input.streamKey ?? '',
    mode: 'snapshot',
    state: {},
    credential,
    config: connector.config,
    requestConfig,
    onPageMeta: (meta) => {
      if (meta.pageIndex === 0) firstHeaders = meta.headers
    },
  })
  // The connector yields the RAW response body per page; sample the first one so
  // schema inference + the field pickers see exactly what the source returns (an
  // array, an object, whatever). Records are selected downstream by the root
  // mapping's rootPath — not here.
  let response: unknown = null
  for await (const record of records) {
    if (isConnectorCheckpoint(record)) continue
    response = record.fields
    break
  }
  const recordCount = Array.isArray(response) ? response.length : response ? 1 : 0
  return { response, recordCount, responseHeaders: pickAllowlisted(firstHeaders) }
}

/** Keep only the allowlisted headers (lowercased keys) before crossing to the client. */
function pickAllowlisted(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const picked: Record<string, string> = {}
  for (const key of SAMPLE_HEADER_ALLOWLIST) {
    if (headers[key] !== undefined) picked[key] = headers[key]
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

// ── Paginating sweep (duplicate-SKU pre-flight, plans/money/design/duplicate-sku-preflight.md §6.1) ──

/**
 * Thrown by {@link drainConnectorFetch} when a sweep is bounded by `maxPages`
 * and the source has not reported exhaustion (no terminal checkpoint) within
 * that ceiling.
 *
 * A bounded sweep that silently truncates is worse than one that fails loudly:
 * the whole point of the duplicate-SKU pre-flight (design §5) is "read the
 * whole catalog, never a sample" — a truncated sweep that reports "no
 * duplicates" over a catalog it never finished reading is a false negative on
 * the one guarantee the report exists to make.
 */
export class ConnectorSweepPageCeilingError extends UnprocessableEntityError {
  constructor(streamKey: string, maxPages: number) {
    super(
      `Connector sweep of stream "${streamKey}" exceeded its ${maxPages}-page ceiling ` +
        'before the source reported it was exhausted. Raise maxPages or run the sweep ' +
        'as a background job instead of an interactive one (design §8 item 4).'
    )
  }
}

/** What {@link drainConnectorFetch} collected from one connector fetch. */
export interface DrainConnectorFetchResult {
  /** Every non-checkpoint record yielded, across every page. */
  records: ConnectorRecord[]
  /** Pages (checkpoints) observed. A connector that never checkpoints (a single
   *  unpaginated response, e.g. the fixture connector) still counts as one page. */
  pagesFetched: number
}

/**
 * Drain a connector fetch's record iterable to exhaustion, collecting every
 * yielded record.
 *
 * Both built-in connectors that page (`generic-rest`'s `fetchRecords` and the
 * app-connector adapter's `invokePage` loop) already loop internally across
 * EVERY page within one `fetch()` call, yielding a `ConnectorCheckpoint`
 * between pages and a terminal one (no `cursor`) when the source is exhausted.
 * That is different from {@link import('./connector-slice-loop').runConnectorSlice},
 * which deliberately STOPS at a page/time/record budget mid-stream so one
 * BullMQ job never blocks past its lock lease, and resumes the next slice from
 * the held cursor. A one-shot interactive sweep has no lease to protect, so
 * this never needs to re-invoke `fetch` with a resume cursor — it only needs to
 * keep consuming until the iterable itself ends.
 *
 * `maxPages` is a sanity ceiling, not a resume point — design §8 item 4 leaves
 * "job + progress vs. a bounded interactive path" for a future task to decide;
 * this just refuses to run forever against a very large catalog. Exceeding it
 * throws {@link ConnectorSweepPageCeilingError} rather than returning a partial
 * result, because a partial sweep cannot honor "never a sample" (design §5).
 *
 * Exported (separately from {@link sweepConnectorFetch}) so the page-boundary
 * and ceiling behavior — the exact regression this exists to guard against, a
 * duplicate that only shows up on a later page — unit-tests against a
 * hand-written `AsyncIterable<ConnectorYield>` without needing a real connector
 * or credential.
 */
export async function drainConnectorFetch(
  records: AsyncIterable<ConnectorYield>,
  streamKey: string,
  maxPages?: number
): Promise<DrainConnectorFetchResult> {
  const collected: ConnectorRecord[] = []
  let pagesFetched = 0
  let sawCheckpoint = false

  for await (const y of records) {
    if (isConnectorCheckpoint(y)) {
      sawCheckpoint = true
      pagesFetched += 1
      if (maxPages !== undefined && pagesFetched > maxPages) {
        throw new ConnectorSweepPageCeilingError(streamKey, maxPages)
      }
      continue
    }
    collected.push(y)
  }

  // A connector that never checkpoints at all (one unpaginated response) still
  // read exactly one page — `pagesFetched` would otherwise read 0 for a
  // perfectly complete sweep.
  return { records: collected, pagesFetched: sawCheckpoint ? pagesFetched : 1 }
}

/** Input to a full-catalog sweep — a stream to page through in its entirety. */
export interface SweepConnectorFetchInput {
  /** Which stream to sweep, e.g. `'product'`. */
  streamKey: string
  /** Per-stream request config (generic-rest); omitted for app connectors. */
  requestConfig?: StreamRequestConfig
  /** Ceiling on pages fetched before {@link ConnectorSweepPageCeilingError}. Unbounded when omitted. */
  maxPages?: number
}

/**
 * Page through a connector stream in its ENTIRETY — the same definition +
 * resolved credential {@link sampleConnectorFetch} uses (`prepareConnectorFetch`,
 * §top-of-file), no sink, but never stopping at the first page. A sibling
 * rather than a `sampleConnectorFetch` option: callers of the test-fetch
 * preview rely on it returning immediately after the first page, so this
 * cannot be folded into it without changing that contract.
 *
 * Read-only: this never constructs a sink, never calls `entitySink`, and never
 * touches `DataConnectorItem`/`EntityInstance`. It is the read-only core the
 * duplicate-SKU adoption pre-flight sweeps with
 * (`data-connectors/preflight/sweep.ts`).
 */
export async function sweepConnectorFetch(
  db: Database,
  organizationId: string,
  userId: string,
  connector: DataConnectorRow,
  input: SweepConnectorFetchInput
): Promise<DrainConnectorFetchResult> {
  const { definition, credential } = await prepareConnectorFetch(
    db,
    organizationId,
    connector,
    userId
  )
  const requestConfig = await resolveRequestConfig(db, organizationId, connector, {
    streamKey: input.streamKey,
    requestConfig: input.requestConfig,
  })
  const { records } = await definition.fetch({
    streamKey: input.streamKey,
    // Always a full crawl, never the incremental delta — the sweep must see
    // every variant regardless of what the connector's steady-state cursor
    // remembers (design §5: "read the whole catalog, not a sample").
    mode: 'snapshot',
    state: {},
    credential,
    config: connector.config,
    requestConfig,
  })
  return drainConnectorFetch(records, input.streamKey, input.maxPages)
}
