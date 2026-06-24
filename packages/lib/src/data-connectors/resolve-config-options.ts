// packages/lib/src/data-connectors/resolve-config-options.ts

import type { Database } from '@auxx/database'
import { invokeAppToolForOptions, type ResolveToolOptionsResult } from '../apps/tool-options'
import { getCachedInstalledApps } from '../cache/org-cache-helpers'
import { getConnector } from './service'

/** Input for {@link resolveConnectorConfigOptions}. */
export interface ResolveConnectorConfigOptionsInput {
  db: Database
  organizationId: string
  organizationHandle: string
  /** The `DataConnector` row id whose config field declares the dynamic select. */
  connectorId: string
  /** Which config field's `configOptionHints` entry to resolve. */
  fieldKey: string
  query?: string
}

/**
 * Resolve the live options for a data-connector config `dynamic-select` field
 * (e.g. the repos for the connected GitHub account). Runs the app tool named by
 * the field's `configOptionHints[fieldKey].dynamicSelect.optionsFrom` through the
 * connector's OWN bound connection — the same credential the sync uses — and
 * shapes its output into options. Read-only; returns the disabled/empty state on
 * any failure (never throws on resolution gaps).
 *
 * Shares the generic {@link invokeAppToolForOptions} core with the quick-action
 * resolver; the only connector-specific work is resolving the connection from the
 * connector's `credentialId` (no surrounding entity to bind args against).
 */
export async function resolveConnectorConfigOptions(
  input: ResolveConnectorConfigOptionsInput
): Promise<ResolveToolOptionsResult> {
  const connectorResult = await getConnector(input.db, input.organizationId, input.connectorId)
  if (connectorResult.isErr()) {
    throw new Error(`Connector not found: ${input.connectorId}`)
  }
  const connector = connectorResult.value
  const slug = connector.type.replace(/^app:/, '')

  // Locate the installed app + its catalogued connector (mirrors the
  // `connectorSchema` procedure / the app-connector adapter resolution).
  const installedApps = await getCachedInstalledApps(input.organizationId)
  const installedApp =
    installedApps.find((a) => a.installationId === connector.appInstallationId) ??
    installedApps.find((a) => a.app.slug === slug)
  if (!installedApp) {
    throw new Error(`Installed app not found for connector ${input.connectorId}`)
  }
  const catalogConnector =
    installedApp.dataConnectors?.find((c) => c.configOptionHints?.[input.fieldKey]) ??
    installedApp.dataConnectors?.[0]
  const hintEntry = catalogConnector?.configOptionHints?.[input.fieldKey]
  if (!hintEntry || hintEntry.kind !== 'dynamic-select') {
    throw new Error(
      `No dynamic-select hint for connector "${input.connectorId}" config "${input.fieldKey}"`
    )
  }
  const hint = hintEntry.dynamicSelect
  const disabled = (): ResolveToolOptionsResult => ({
    options: [],
    disabledHint: hint.emptyHint ?? null,
  })

  // Resolve the connector's bound connection — the SAME credential the sync
  // borrows (credentialId on the connector row), decrypted into the runtime
  // connection shape. Lazy-import the runtime cluster (vitest/billing-dist).
  const { resolveAppConnectionForRuntime } = await import(
    '../apps/connections/resolve-app-connection-for-runtime'
  )
  const resolveInput = connector.credentialId
    ? {
        appId: installedApp.app.id,
        organizationId: input.organizationId,
        userId: '',
        connectionId: connector.credentialId,
      }
    : { appId: installedApp.app.id, organizationId: input.organizationId, userId: '' }
  const connections = await resolveAppConnectionForRuntime(resolveInput)
  if (connections.isErr()) return disabled()
  const { userConnection, organizationConnection } = connections.value

  return invokeAppToolForOptions({
    appId: installedApp.app.id,
    installationId: installedApp.installationId,
    organizationId: input.organizationId,
    organizationHandle: input.organizationHandle,
    userConnection,
    organizationConnection,
    hint,
    invocationContext: { kind: 'data-connector-config', connectorId: input.connectorId },
    query: input.query,
  })
}
