// apps/web/src/components/data-connectors/ui/connection-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { ChevronRight, Globe, Plug, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { ConnectionList } from '~/components/apps/ui/connection-list'
import { ConnectionPickerPopover } from '~/components/apps/ui/connection-picker-popover'
import { ConnectionRow, type ConnectionStatus } from '~/components/apps/ui/connection-row'
import {
  AddConnectionDialog,
  type ConnectionRestriction,
} from '~/components/connections/ui/add-connection-dialog'
import { api } from '~/trpc/react'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

interface ConnectionSectionProps {
  connector: Connector
  /** Drill into the `source` NavStackPanel (connector-level fetch config). */
  onOpenSource: () => void
}

/**
 * Connection section — two parts (05 §3): (a) the single bound credential
 * (`ConnectionRow` + an account picker), and (b) a source card that drills into
 * the `source` panel hosting the connector-level fetch config (generic-rest HTTP
 * slice / app-template config form). One connector binds exactly one connection.
 *
 * "+ New connection" opens the full connection catalog, scoped to what the connector
 * expects: an app connector pins to that app's methods (API key OR OAuth2); a template
 * pins to its declared provider/app (`connectionHint`); a bare generic-rest connector
 * gets the unrestricted catalog. This replaces the legacy always-mint-an-API-key path.
 */
export function ConnectionSection({ connector, onOpenSource }: ConnectionSectionProps) {
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

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
  })

  // The picker lists across kinds; the picked row carries `appInstallationId`
  // (set for app creds so token refresh + lifecycle stay wired — 01 §1). A freshly
  // created connection carries the installationId we resolved from the restriction.
  const bindCredential = (credentialId: string, appInstallationId: string | null = null) =>
    update.mutate({ id: connector.id, credentialId, appInstallationId })

  const connected = !!connector.credentialId
  const status: ConnectionStatus = connected ? 'connected' : 'disconnected'

  return (
    <Section
      title='Connection'
      icon={<Plug className='size-4' />}
      initialOpen
      collapsible={false}
      description='The credential this connector uses and how it fetches data.'>
      <div className='flex flex-col gap-4 px-1'>
        <ConnectionList>
          <ConnectionRow
            status={status}
            title={connected ? 'Connected account' : 'Not connected'}
            subtitle={
              connected
                ? 'This connector is using a bound credential.'
                : isGenericRest
                  ? 'Add an API key / secret to authorize requests.'
                  : 'Connect an account to authorize this connector.'
            }
            actions={() => (
              <ConnectionPickerPopover
                value={connector.credentialId ?? undefined}
                onPick={(credentialId, row) => bindCredential(credentialId, row.appInstallationId)}
                onCreateNew={() => setAddOpen(true)}
                trigger={
                  <Button variant='outline' size='sm'>
                    <Plug />
                    {connected ? 'Switch connection' : 'Connect'}
                  </Button>
                }
              />
            )}
          />
        </ConnectionList>

        {/* Source card → drills the `source` panel. */}
        <button
          type='button'
          onClick={onOpenSource}
          className='flex items-center justify-between gap-3 rounded-lg border bg-background p-3 text-left hover:bg-primary-50/50'>
          <div className='flex items-center gap-3'>
            <span className='flex size-8 items-center justify-center rounded-lg border'>
              {isGenericRest ? <Globe className='size-4' /> : <Settings2 className='size-4' />}
            </span>
            <div className='flex flex-col'>
              <span className='text-sm font-medium'>
                {isGenericRest ? 'Request configuration' : 'Connector settings'}
              </span>
              <span className='text-xs text-muted-foreground'>
                {isGenericRest
                  ? 'Base URL and shared headers for every stream.'
                  : 'Options declared by this connector.'}
              </span>
            </div>
          </div>
          <ChevronRight className='size-4 text-muted-foreground' />
        </button>
      </div>

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        providers={providers}
        installedApps={connectableApps}
        isLoading={providersLoading}
        restrictTo={restrictTo}
        onConnected={() => void utils.credentials.list.invalidate()}
        onConnectedCredential={(credentialId) =>
          bindCredential(credentialId, restrictedInstallationId)
        }
      />
    </Section>
  )
}
