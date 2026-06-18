// apps/web/src/components/data-connectors/ui/connection-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { ChevronRight, Globe, Plug, Settings2 } from 'lucide-react'
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
  const isGenericRest = !connector.type.startsWith('app:')
  // app:<slug> connectors bind via the app account; generic-rest binds a secret connection.
  const appId = connector.type.startsWith('app:') ? connector.type.slice('app:'.length) : null

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
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
                : appId
                  ? 'Connect an account to authorize this connector.'
                  : 'Add an API key / secret to authorize requests.'
            }
            actions={() => (
              <AppAccountPopover
                appId={appId}
                value={connector.credentialId ?? undefined}
                onPick={(credId) => update.mutate({ id: connector.id, credentialId: credId })}
                onConnected={(credId) => update.mutate({ id: connector.id, credentialId: credId })}
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
