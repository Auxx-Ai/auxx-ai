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
import { connectorFor } from './connectors'
import type { DataConnectorDefinition, StreamRequestConfig } from './connectors/types'
import { isConnectorCheckpoint } from './connectors/types'
import type { DataConnectorRow } from './service'

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
  /** The per-stream request config being edited (generic-rest). */
  requestConfig?: StreamRequestConfig
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
    requestConfig: input.requestConfig,
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
