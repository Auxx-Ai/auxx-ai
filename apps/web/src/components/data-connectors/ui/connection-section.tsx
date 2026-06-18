// apps/web/src/components/data-connectors/ui/connection-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { ChevronRight, Globe, Plug, Settings2 } from 'lucide-react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppAccountPopover } from '~/components/apps/ui/app-account-popover'
import { ConnectionList } from '~/components/apps/ui/connection-list'
import { ConnectionRow, type ConnectionStatus } from '~/components/apps/ui/connection-row'
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
 */
export function ConnectionSection({ connector, onOpenSource }: ConnectionSectionProps) {
  const utils = api.useUtils()
  const { appInstallations } = useAppsContext()
  const isGenericRest = !connector.type.startsWith('app:')
  // app:<slug> connectors borrow the installed app's credential; generic-rest binds a
  // secret connection. The connector type stores the app *slug*, but the account picker
  // keys off App.id — so resolve the installation by slug and feed the picker its id.
  const slug = connector.type.startsWith('app:') ? connector.type.slice('app:'.length) : null
  const installation = slug ? (appInstallations.find((i) => i.app.slug === slug) ?? null) : null
  const appId = installation?.app.id ?? null

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
  })

  // Borrowing an app credential also records the installation (token refresh + lifecycle
  // live on the app connection — DataConnector.appInstallationId, 01 §1).
  const bindCredential = (credentialId: string) =>
    update.mutate({
      id: connector.id,
      credentialId,
      appInstallationId: installation?.installationId ?? null,
    })

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
              <AppAccountPopover
                appId={appId}
                value={connector.credentialId ?? undefined}
                onPick={bindCredential}
                onConnected={bindCredential}
                trigger={
                  <Button variant='outline' size='sm'>
                    <Plug />
                    {connected ? 'Switch account' : 'Connect'}
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
    </Section>
  )
}
