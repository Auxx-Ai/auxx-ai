// packages/lib/src/data-connectors/connectors/app-connector-adapter.ts
// App-connector adapter (phase 4). An `app:<slug>` connector fetches inside the
// app-runtime sandbox and yields source-shaped ConnectorRecords; the platform
// validates + maps + writes (the sink — untouched here). This adapter resolves
// the app's catalog-declared streams at construction time and, in `fetch()`,
// invokes the app's `execute` export through the app-runtime cluster.
//
// LAZY-IMPORT @auxx/lib/apps inside fetch() — a static import of the cluster
// drags billing/dist into vitest (project memory). The streams projection comes
// from the installed-apps org cache (no bundle evaluation).

import type { CatalogDataConnector, Database } from '@auxx/database'
import { createScopedLogger } from '../../logger'
import type { SyncCursor } from '../../sync-core/contracts'
import type { DataConnectorConfig } from '../types'
import { decodeCursor, encodeCursor } from './app-connector-state'
import {
  ConnectorRateLimitError,
  type ConnectorRecord,
  type ConnectorStreamDecl,
  type ConnectorYield,
  type DataConnectorDefinition,
  type FetchResult,
} from './types'

/** What an app's `execute` returns per page (the SDK's flat `ConnectorFetchResult`). */
interface AppExecuteResult {
  records?: ConnectorRecord[]
  nextState?: {
    /** Flat resume cursor — any JSON-serializable value (string or structured). */
    cursor?: unknown
    /** Steady-phase delta floor the app advances. */
    updatedSince?: string
    /** Set on the last page — flips the stream to steady / finishes the snapshot. */
    backfillComplete?: boolean
  }
  /**
   * Upstream throttle signal (mirrors the SDK `ConnectorFetchResult.rateLimited`).
   * The signal crosses the sandbox boundary as plain DATA; the adapter re-throws it
   * as a real `ConnectorRateLimitError` (in-realm) so the slice loop's existing
   * back-off handling can pace the re-enqueue. Cross-realm `instanceof` from inside
   * the sandbox would never match — this is why the app returns data, not an error.
   */
  rateLimited?: {
    retryAfterMs?: number
  }
}

const logger = createScopedLogger('app-connector-adapter')

/**
 * Keys of `DataConnectorConfig` the PLATFORM owns. Everything else on a connector's
 * `config` belongs to the app's own declared `config` schema — see
 * {@link appDeclaredConfig}.
 */
const PLATFORM_RESERVED_CONFIG_KEYS = new Set([
  'endpoint',
  'filters',
  'backfillWindowSpan',
  'webhookTrigger',
])

/**
 * The app's own connector config: every top-level key on `connector.config` that the
 * platform hasn't reserved. The setup stepper writes the app's declared keys flat at
 * the top level, so this is where they actually are.
 */
function appDeclaredConfig(config: DataConnectorConfig | undefined): Record<string, unknown> {
  if (!config) return {}
  return Object.fromEntries(
    Object.entries(config as Record<string, unknown>).filter(
      ([key]) => !PLATFORM_RESERVED_CONFIG_KEYS.has(key)
    )
  )
}

/**
 * Construction-time context for an app connector. Threaded from the orchestrator
 * via `connectorFor(type, context)` so the adapter can resolve the installed
 * app, its catalog streams, and the borrowed credential. The orchestrator passes
 * the connector row it already loaded; the adapter never re-reads it.
 */
export interface AppConnectorContext {
  db: Database
  organizationId: string
  connector: {
    id: string
    type: string
    /** The borrowed OAuth credential (set on the connector row). */
    credentialId: string | null
    /** The installed app whose credential + bundle this connector borrows. */
    appInstallationId: string | null
  }
}

/** Map an installed-apps cache row to the catalog connector for this `app:<slug>` type. */
function pickCatalogConnector(
  installedApp: {
    dataConnectors?: CatalogDataConnector[]
  } | null
): CatalogDataConnector | null {
  const connectors = installedApp?.dataConnectors ?? []
  if (connectors.length === 0) return null
  // v1: one connector per app type per org. Multi-connector apps would carry a
  // catalogConnectorId discriminator on the connector row — TODO when needed.
  return connectors[0] ?? null
}

/**
 * The engine's `ConnectorStreamDecl` is now a direct mirror of the catalog's
 * `CatalogConnectorStream` (app-fields-and-entities-plan Phase 2 §4.3) — there
 * is nothing left to reshape, so this is the identity projection. Kept as a
 * named function (rather than inlining `catalog.streams`) so the two types
 * staying in lock-step is a compile-time fact at exactly one call site.
 */
function toEngineStreams(catalog: CatalogDataConnector): ConnectorStreamDecl[] {
  return catalog.streams
}

/**
 * Resolve the connector definition for an `app:<slug>` type. The returned
 * definition's `streams` come from the app's catalog declaration; its `fetch`
 * invokes the app's `execute` export through the app-runtime cluster.
 *
 * Without context (e.g. a catalog-only lookup), returns an empty-stream
 * definition whose `fetch` throws — the orchestrator always passes context.
 */
export function appConnectorAdapter(
  type: string,
  context?: AppConnectorContext
): DataConnectorDefinition {
  const slug = type.replace(/^app:/, '')

  if (!context) {
    return {
      type,
      schemaVersion: 1,
      requestModel: 'fixed',
      streams: [],
      async fetch() {
        throw new Error(
          `App connector '${slug}' resolved without context — connectorFor(type, context) is required for fetch.`
        )
      },
    }
  }

  // `db` is part of the context contract (future direct queries) but the
  // adapter resolves everything via the org cache + lambda cluster today.
  const { organizationId, connector } = context

  // Streams are resolved lazily on first access so construction stays sync and
  // cheap (the org cache read happens in fetch / the streams getter).
  let cachedStreams: ConnectorStreamDecl[] | null = null
  let cachedCatalog: CatalogDataConnector | null = null

  /** Load the installed app + its catalog connector from the org cache (lazy). */
  async function resolveCatalog(): Promise<CatalogDataConnector | null> {
    if (cachedCatalog) return cachedCatalog
    // Lazy-import the cache barrel — same isolation discipline as the cluster.
    const { getOrgCache } = await import('../../cache')
    const installedApps = await getOrgCache().get(organizationId, 'installedApps')
    const installedApp =
      installedApps.find((a) => a.installationId === connector.appInstallationId) ??
      installedApps.find((a) => a.app.slug === slug) ??
      null
    cachedCatalog = pickCatalogConnector(installedApp)
    if (cachedCatalog) cachedStreams = toEngineStreams(cachedCatalog)
    return cachedCatalog
  }

  return {
    type,
    schemaVersion: 1,
    requestModel: 'fixed',
    // Synchronously-empty until first fetch warms the cache; the orchestrator
    // reads streams only for reconciliation after a fetch has run.
    get streams(): ConnectorStreamDecl[] {
      return cachedStreams ?? []
    },

    async fetch(args): Promise<FetchResult> {
      const catalog = await resolveCatalog()
      if (!catalog) {
        throw new Error(
          `App connector '${slug}': no data connector found in the installed app's catalog ` +
            `(installation ${connector.appInstallationId ?? 'unknown'}).`
        )
      }

      // Lazy-import the app-runtime cluster — a static import pulls billing/dist
      // into vitest (project memory). Everything below runs only at fetch time.
      const [
        { invokeLambdaExecutor, prepareLambdaContext },
        { resolveAppConnectionForRuntime },
        { getOrgCache },
      ] = await Promise.all([
        import('../../apps/lambda'),
        import('../../apps/connections/resolve-app-connection-for-runtime'),
        import('../../cache'),
      ])

      // Resolve the installed app row (id/slug, serverBundleSha, org handle) from
      // the cache — needed to build the lambda context + locate the bundle.
      const installedApps = await getOrgCache().get(organizationId, 'installedApps')
      const installedApp =
        installedApps.find((a) => a.installationId === connector.appInstallationId) ??
        installedApps.find((a) => a.app.slug === slug) ??
        null
      if (!installedApp?.currentDeployment) {
        throw new Error(
          `App connector '${slug}': installed app has no current deployment (cannot fetch).`
        )
      }
      const orgProfile = await getOrgCache().get(organizationId, 'orgProfile')
      const organizationHandle = orgProfile?.handle ?? null

      // Resolve the borrowed connection. The connector binds the app's OAuth
      // credential (credentialId on the connector row); decrypt + lazy-refresh
      // is handled by the resolver (the orchestrator-level credential the
      // builtin connectors get is intentionally NOT used here — the sandbox
      // needs the runtime connection shape, not the raw decrypted secrets).
      let userConnection: unknown
      let organizationConnection: unknown
      if (catalog.requiresConnection) {
        const resolveInput = connector.credentialId
          ? {
              appId: installedApp.app.id,
              organizationId,
              userId: '',
              connectionId: connector.credentialId,
            }
          : { appId: installedApp.app.id, organizationId, userId: '' }
        const resolved = await resolveAppConnectionForRuntime(resolveInput)
        if (resolved.isErr()) {
          throw new Error(
            `App connector '${slug}': failed to resolve connection (${resolved.error.code ?? 'UNKNOWN'}).`
          )
        }
        userConnection = resolved.value.userConnection
        organizationConnection = resolved.value.organizationConnection
      }

      const lambdaContext = prepareLambdaContext({
        appId: installedApp.app.id,
        installationId: installedApp.installationId,
        organizationId,
        organizationHandle,
        userEmail: null,
        userName: orgProfile?.name ?? organizationHandle,
        userConnection,
        organizationConnection,
      })

      // The app's connector-level config (validated against its `config` zod schema
      // inside the sandbox).
      //
      // Read from the TOP LEVEL of `connector.config`, minus the platform's own keys.
      // This used to read `args.config?.filters`, which was always `{}`: the setup
      // stepper writes each declared key at the top level (`setConfig({ ...cur, [key]:
      // next })`) and `createConnectorFromAppCatalog` seeds only `webhookTrigger`, so
      // NOTHING ever wrote `config.filters` for an app connector. An app's declared
      // config never reached its `execute`. Shopify declares `config: z.object({})`,
      // which is the only reason nobody hit it.
      //
      // Subtracting the reserved keys rather than moving the UI under `filters` is
      // deliberate: `filters` is a real engine key the fixture connector already reads
      // (`config.filters.fixtures`), and the top-level shape is what the schema form and
      // the required-field gate both assume.
      const config = appDeclaredConfig(args.config)
      const serverBundleSha = installedApp.currentDeployment.serverBundleSha

      // Invoke the app's `execute` for ONE page. Each sandbox round-trip is request/
      // response — a finite batch + flat cursor. The adapter sends the FLAT app state
      // (`{ cursor, updatedSince }`), NOT the engine-shaped `{ backfillCursor, watermark }`,
      // so the app reads `state.cursor`/`state.updatedSince` per the SDK contract.
      // An arrow const, not a hoisted `function` declaration: a declaration can be
      // called before the `if (!catalog) throw` above runs, so TS refuses to carry that
      // narrowing into its body and `catalog.id` reads as possibly-null.
      const invokePage = async (flat: {
        cursor: unknown
        updatedSince?: string
      }): Promise<AppExecuteResult> => {
        const result = await invokeLambdaExecutor({
          caller: 'data-connector',
          payload: {
            type: 'data-connector',
            serverBundleSha,
            connectorId: catalog.id,
            streamKey: args.streamKey,
            mode: args.mode,
            state: { cursor: flat.cursor, updatedSince: flat.updatedSince },
            config,
            triggerContext: args.triggerContext, // ← webhook steer tokens (undefined on normal syncs)
            context: lambdaContext,
            timeout: 30000,
          },
        })
        if (result.isErr()) {
          throw new Error(
            `App connector '${slug}' fetch failed (${result.error.code}): ${result.error.message}`
          )
        }
        return (result.value.execution_result as AppExecuteResult | undefined) ?? {}
      }

      // Inbound translation (Gap 1): engine `SyncCursor` → flat app cursor. The
      // engine hands resume state in as `state.backfillCursor` (structured) +
      // `state.watermark`; the app never sees either.
      const engineState = (args.state ?? {}) as {
        backfillCursor?: SyncCursor
        watermark?: string
      }
      let flat: { cursor: unknown; updatedSince?: string } = {
        cursor: decodeCursor(engineState.backfillCursor),
        updatedSince: engineState.watermark,
      }

      // Loop `execute` (one page each), threading the flat cursor between our own
      // calls (NOT re-reading engine state mid-slice), and emit a checkpoint after
      // each page so the sliced `SyncSource` can bound + resume — exactly like
      // generic-rest. The generator only `return`s on the terminal checkpoint.
      return {
        records: (async function* (): AsyncGenerator<ConnectorYield> {
          while (true) {
            const { records = [], nextState = {}, rateLimited } = await invokePage(flat)
            for (const record of records) yield record

            // Upstream throttle (§2): the app couldn't fetch this page and asked us to
            // back off. Re-throw as the in-realm lib error so the slice loop folds
            // `retryAfterMs` into the re-enqueue delay. Records yielded above (earlier
            // pages this slice) are kept; the throttled page is retried after the wait.
            if (rateLimited) {
              throw new ConnectorRateLimitError(
                `App connector '${slug}' rate-limited by upstream`,
                rateLimited.retryAfterMs
              )
            }

            const watermark = nextState.updatedSince
            logger.info('app connector page complete', {
              slug,
              connectorId: catalog.id,
              streamKey: args.streamKey,
              recordCount: records.length,
            })

            // Terminal: the app signals done (or hands back no cursor) ⇒ a
            // checkpoint with no cursor tells the slice loop this phase is exhausted.
            if (nextState.backfillComplete || nextState.cursor == null) {
              yield { __checkpoint: true, watermark }
              return
            }

            // Resume point: JSON-encode the (possibly structured) flat cursor into the
            // opaque token `SyncCursor` the engine persists, and continue paging.
            flat = { cursor: nextState.cursor, updatedSince: nextState.updatedSince }
            yield { __checkpoint: true, cursor: encodeCursor(nextState.cursor), watermark }
          }
        })(),
        // The engine ignores `nextState` on the sliced path; checkpoints carry the cursor.
        nextState: {},
      }
    },
  }
}
