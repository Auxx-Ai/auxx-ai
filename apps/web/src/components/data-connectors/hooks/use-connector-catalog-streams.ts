// apps/web/src/components/data-connectors/hooks/use-connector-catalog-streams.ts
'use client'

import { useAppsContext } from '~/components/apps/providers/apps-context'

/** The installed app's catalog streams for an app connector; empty for any other connector. */
export function useConnectorCatalogStreams(connector: {
  definitionKind: string
  appInstallationId: string | null
  credentialId: string | null
}) {
  const { appInstallations, appConnections } = useAppsContext()
  if (connector.definitionKind !== 'app') return []
  const installationId =
    connector.appInstallationId ??
    appConnections.find((c) => c.id === connector.credentialId)?.appInstallationId ??
    null
  const installation = installationId
    ? appInstallations.find((i) => i.installationId === installationId)
    : undefined
  return installation?.dataConnectors?.[0]?.streams ?? []
}
