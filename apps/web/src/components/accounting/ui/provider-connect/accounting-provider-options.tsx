// apps/web/src/components/accounting/ui/provider-connect/accounting-provider-options.tsx
'use client'

import { ACCOUNTING_PROVIDER_CATALOGUE } from '@auxx/lib/accounting/providers/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Landmark } from 'lucide-react'
import { useState } from 'react'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'

interface AccountingProviderOptionsProps {
  /** Where the OAuth popup-blocked fallback returns to. */
  returnTo: string
}

/**
 * One card per catalogue provider, each with its own install / connect / manage control. Connect
 * and Manage open `AppSettingsDialog` rather than navigating, so the person stays where they are.
 */
export function AccountingProviderOptions({ returnTo }: AccountingProviderOptionsProps) {
  const status = useAccountingProviderStatus()
  const [dialogOpen, setDialogOpen] = useState(false)

  if (status.loading) return <EmptySection loading />

  return (
    <div className='flex flex-col gap-2'>
      {ACCOUNTING_PROVIDER_CATALOGUE.map((entry) => {
        const installed = status.providerEntry?.id === entry.id
        const connected = installed && status.connected
        return (
          <div key={entry.id} className='flex flex-col gap-2 rounded-xl border p-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <Landmark className='size-4 text-muted-foreground' />
              <span className='font-medium text-sm'>{entry.label}</span>
              {connected && (
                <Badge variant='green' size='sm'>
                  Connected
                </Badge>
              )}
            </div>

            {connected ? (
              <>
                <p className='text-muted-foreground text-xs'>
                  {status.connection?.label ?? 'Connected'}. Continue to import from it.
                </p>
                <div>
                  <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                    Manage connection
                  </Button>
                </div>
              </>
            ) : installed ? (
              <>
                <p className='text-muted-foreground text-xs'>
                  Installed, but not yet authorized. Connecting opens {entry.shortLabel} to sign in
                  and choose a company.
                </p>
                <div>
                  <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                    Connect {entry.shortLabel}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className='text-muted-foreground text-xs'>
                  {entry.description} Not installed. Add it, then connect it.
                </p>
                <div>
                  <InlineAppInstallButton appSlug={entry.appSlug} />
                </div>
              </>
            )}
          </div>
        )
      })}

      {status.providerEntry && status.installationType && (
        <AppSettingsDialog
          appSlug={status.providerEntry.appSlug}
          installationType={status.installationType}
          returnTo={returnTo}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialTab={status.connected ? 'about' : 'connections'}
        />
      )}
    </div>
  )
}
