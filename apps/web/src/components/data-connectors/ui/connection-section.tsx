// apps/web/src/components/data-connectors/ui/connection-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { ChevronRight, Globe, Plug, Settings2 } from 'lucide-react'
import { ConnectionList } from '~/components/apps/ui/connection-list'
import { ConnectionPickerPopover } from '~/components/apps/ui/connection-picker-popover'
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

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
  })

  // The picker lists across kinds; the picked row carries `appInstallationId`
  // (set for app creds so token refresh + lifecycle stay wired — 01 §1). A
  // freshly-minted "+ New connection" integration secret has none.
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
                onCreated={(credentialId) => bindCredential(credentialId, null)}
                createConnection={{ type: connector.type, label: `${connector.name} API key` }}
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
    </Section>
  )
}
