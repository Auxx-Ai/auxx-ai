// apps/web/src/components/data-connectors/ui/connection-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Plug } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppWithStatusIcon } from '~/components/apps/ui/app-with-status-icon'
import { resolveConnectionDisplay } from '~/components/apps/ui/connection-display'
import { ConnectionList } from '~/components/apps/ui/connection-list'
import { ConnectionPickerPopover } from '~/components/apps/ui/connection-picker-popover'
import { ConnectionRow, type ConnectionStatus } from '~/components/apps/ui/connection-row'
import {
  AddConnectionDialog,
  type ConnectionRestriction,
} from '~/components/connections/ui/add-connection-dialog'
import { api, type RouterOutputs } from '~/trpc/react'
import { SourceConfigPanel } from './source-config-panel'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

interface ConnectionSectionProps {
  connector: Connector
}

/**
 * Connection section — two parts (05 §3): (a) the single bound credential
 * (`ConnectionRow` + an account picker), and (b) the connector-level fetch config
 * (generic-rest HTTP slice / app-template config form) rendered inline below it
 * via `SourceConfigPanel`. One connector binds exactly one connection.
 *
 * "+ New connection" opens the full connection catalog, scoped to what the connector
 * expects: an app connector pins to that app's methods (API key OR OAuth2); a template
 * pins to its declared provider/app (`connectionHint`); a bare generic-rest connector
 * gets the unrestricted catalog. This replaces the legacy always-mint-an-API-key path.
 */
export function ConnectionSection({ connector }: ConnectionSectionProps) {
  const utils = api.useUtils()
  const { appInstallations } = useAppsContext()
  const [addOpen, setAddOpen] = useState(false)

  // Branch on the persisted definitionKind (05c §7), not a `type` prefix sniff.
  // Template instances are generic-rest ⇒ 'builtin' ⇒ they get the builder card.
  const isGenericRest = connector.definitionKind !== 'app'

  const { data: providers = [], isLoading: providersLoading } =
    api.connections.listProviders.useQuery()

  // Installed apps that actually expose a connection (have a scoped definition).
  const connectableApps = useMemo(
    () =>
      appInstallations.filter(
        (i) => i.connectionDefinitions?.user || i.connectionDefinitions?.organization
      ),
    [appInstallations]
  )

  // What the "+ New connection" catalog is allowed to show: the app this connector
  // comes from, the provider/app a template declares, or nothing (⇒ full catalog).
  const restrictTo = useMemo<ConnectionRestriction | undefined>(() => {
    if (connector.definitionKind === 'app' && connector.type.startsWith('app:')) {
      return { kind: 'app', appSlug: connector.type.slice('app:'.length) }
    }
    const hint = connector.connectionHint
    if (hint?.appSlug) return { kind: 'app', appSlug: hint.appSlug }
    if (hint?.providerKey) return { kind: 'provider', providerKey: hint.providerKey }
    return undefined
  }, [connector.definitionKind, connector.type, connector.connectionHint])

  // When pinned to an app, bind its installationId so the app cred keeps token refresh
  // + lifecycle wired (01 §1). Platform/secret creds (or the open catalog) bind none.
  const restrictedInstallationId = useMemo(() => {
    if (restrictTo?.kind !== 'app') return null
    return appInstallations.find((i) => i.app.slug === restrictTo.appSlug)?.installationId ?? null
  }, [restrictTo, appInstallations])

  // Human label for the connection this connector expects (app title / provider label),
  // used for the "Connect Gmail" trigger + "Recommended: Gmail" subtitle + picker nudge.
  const preferredLabel = useMemo(() => {
    if (restrictTo?.kind === 'app') {
      return appInstallations.find((i) => i.app.slug === restrictTo.appSlug)?.app.title ?? null
    }
    if (restrictTo?.kind === 'provider') {
      return providers.find((p) => p.providerKey === restrictTo.providerKey)?.label ?? null
    }
    return null
  }, [restrictTo, appInstallations, providers])

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
  })

  // The picker lists across kinds; the picked row carries `appInstallationId`
  // (set for app creds so token refresh + lifecycle stay wired — 01 §1). A freshly
  // created connection carries the installationId we resolved from the restriction.
  const bindCredential = (credentialId: string, appInstallationId: string | null = null) =>
    update.mutate({ id: connector.id, credentialId, appInstallationId })

  const connected = !!connector.credentialId

  // Resolve the bound connection to surface its real icon + name (e.g. "Gmail")
  // instead of a generic "bound credential" line. Shares the picker popover's
  // query (same input) so this adds no extra fetch.
  const { data: connections = [] } = api.connections.list.useQuery(
    { kind: ['app', 'integration', 'workflow'], orgScopedOnly: true },
    { refetchOnWindowFocus: false }
  )
  const bound = connector.credentialId
    ? connections.find((c) => c.id === connector.credentialId)
    : undefined
  const boundDisplay = bound ? resolveConnectionDisplay(bound, appInstallations) : null
  const status: ConnectionStatus = connected ? 'connected' : 'disconnected'

  // Existing connections that match what this connector expects (its app/provider hint).
  // Surfaced as "Recommended" in the picker — biases, never auto-binds (05c §8).
  const preferredCredentialIds = useMemo(() => {
    if (restrictedInstallationId) {
      return connections
        .filter((c) => c.appInstallationId === restrictedInstallationId)
        .map((c) => c.id)
    }
    if (restrictTo?.kind === 'provider') {
      return connections.filter((c) => c.type === restrictTo.providerKey).map((c) => c.id)
    }
    return []
  }, [connections, restrictedInstallationId, restrictTo])

  return (
    <>
      <Section
        title='Connection'
        icon={<Plug className='size-4' />}
        initialOpen
        collapsible={false}
        description='The credential this connector uses to authorize requests.'>
        <div className='flex flex-col gap-4 px-1'>
          <ConnectionList>
            <ConnectionRow
              status={status}
              statusIcon={
                boundDisplay ? (
                  <AppWithStatusIcon
                    iconId={boundDisplay.iconId}
                    size='sm'
                    status={bound?.status ?? 'connected'}
                  />
                ) : undefined
              }
              title={boundDisplay?.title ?? (connected ? 'Connected account' : 'Not connected')}
              subtitle={
                connected
                  ? 'This connector is using a bound credential.'
                  : preferredLabel
                    ? `Recommended: ${preferredLabel}.`
                    : isGenericRest
                      ? 'Add an API key / secret to authorize requests.'
                      : 'Connect an account to authorize this connector.'
              }
              actions={() => (
                <ConnectionPickerPopover
                  value={connector.credentialId ?? undefined}
                  onPick={(credentialId, row) =>
                    bindCredential(credentialId, row.appInstallationId)
                  }
                  onCreateNew={() => setAddOpen(true)}
                  preferredCredentialIds={preferredCredentialIds}
                  preferredLabel={preferredLabel ?? undefined}
                  trigger={
                    <Button variant='outline' size='sm'>
                      <Plug />
                      {connected
                        ? 'Switch connection'
                        : preferredLabel
                          ? `Connect ${preferredLabel}`
                          : 'Connect'}
                    </Button>
                  }
                />
              )}
            />
          </ConnectionList>
        </div>
      </Section>

      {/* Connector-level fetch config, inlined below the credential. */}
      <SourceConfigPanel connector={connector} />

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        providers={providers}
        installedApps={connectableApps}
        isLoading={providersLoading}
        restrictTo={restrictTo}
        onConnected={() => void utils.connections.list.invalidate()}
        onConnectedCredential={(credentialId) =>
          bindCredential(credentialId, restrictedInstallationId)
        }
      />
    </>
  )
}
