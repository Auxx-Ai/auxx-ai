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
import type {
  ConnectorRecord,
  ConnectorStreamDecl,
  DataConnectorDefinition,
  FetchResult,
} from './types'

const logger = createScopedLogger('app-connector-adapter')

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

/** Project a catalog stream declaration into the engine `ConnectorStreamDecl` shape. */
function toEngineStreams(catalog: CatalogDataConnector): ConnectorStreamDecl[] {
  return catalog.streams.map((stream) => ({
    key: stream.key,
    displayFieldKey: stream.displayFieldKey,
    fields: Object.fromEntries(
      stream.fields.map((f) => [
        f.fieldKey,
        {
          fieldKey: f.fieldKey,
          sourcePath: f.sourcePath,
          type: f.type as ConnectorStreamDecl['fields'][string]['type'],
          name: f.name,
          pii: f.pii,
          capabilities: f.capabilities,
        },
      ])
    ),
    defaultMappings: stream.defaultMappings as ConnectorStreamDecl['defaultMappings'],
    exampleRecord: stream.exampleRecord,
  }))
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

      const result = await invokeLambdaExecutor({
        caller: 'data-connector',
        payload: {
          type: 'data-connector',
          serverBundleSha: installedApp.currentDeployment.serverBundleSha,
          connectorId: catalog.id,
          streamKey: args.streamKey,
          mode: args.mode,
          state: args.state ?? {},
          // The app's connector-level config (validated against its `config` zod
          // schema inside the sandbox). The engine `DataConnectorConfig.filters`
          // carries it; an app that declares top-level config keys reads them
          // from `filters`. Generic-rest `endpoint` is never sent to an app.
          config: (args.config?.filters as Record<string, unknown>) ?? {},
          context: lambdaContext,
          timeout: 30000,
        },
      })

      if (result.isErr()) {
        throw new Error(
          `App connector '${slug}' fetch failed (${result.error.code}): ${result.error.message}`
        )
      }

      const execResult = result.value.execution_result as
        | { records?: ConnectorRecord[]; nextState?: Record<string, unknown> }
        | undefined
      const records = execResult?.records ?? []
      const nextState = execResult?.nextState ?? {}

      logger.info('app connector fetch complete', {
        slug,
        connectorId: catalog.id,
        streamKey: args.streamKey,
        recordCount: records.length,
      })

      // The platform validates each record against the stream source schema, then
      // maps + sinks (untouched). We hand back an async iterable so the
      // orchestrator streams without buffering downstream.
      return {
        records: (async function* () {
          for (const record of records) yield record
        })(),
        nextState,
      }
    },
  }
}
