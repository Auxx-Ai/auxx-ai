// apps/web/src/components/accounting/ui/setup-wizard/wizard-connect-page.tsx
'use client'

// The import path's connect page, shown only while nothing is connected. Connect opens
// `AppSettingsDialog` rather than navigating, so the person stays in the wizard.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Landmark } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'

/** Install, then connect; once connected the wizard moves on to the import by itself. */
export function WizardConnectPage() {
  const status = useAccountingProviderStatus()
  const pathname = usePathname()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Connect your accounting system to import from it. To set up without one, go back and choose
        Use Auxx on its own.
      </p>

      {status.loading ? (
        <EmptySection loading />
      ) : (
        <div className='flex flex-col gap-2 rounded-xl border p-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Landmark className='size-4 text-muted-foreground' />
            <span className='font-medium text-sm'>QuickBooks Online</span>
            {status.connected && (
              <Badge variant='green' size='sm'>
                Connected
              </Badge>
            )}
          </div>

          {status.connected ? (
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
          ) : status.installed ? (
            <>
              <p className='text-muted-foreground text-xs'>
                Installed, but not yet authorized. Connecting opens QuickBooks to sign in and choose
                a company.
              </p>
              <div>
                <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                  Connect QuickBooks
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className='text-muted-foreground text-xs'>
                Not installed. Add it, then connect it.
              </p>
              <div>
                <InlineAppInstallButton appSlug='quickbooks' />
              </div>
            </>
          )}
        </div>
      )}

      <p className='text-muted-foreground text-xs'>
        Nothing is sent to your accounting system until you finish setup.
      </p>

      {status.installed && status.installationType && (
        <AppSettingsDialog
          appSlug='quickbooks'
          installationType={status.installationType}
          // The popup-blocked -> full-page-redirect fallback cannot be fully
          // prevented, so name where to come back to. `/app/accounting` reopens
          // the wizard gate rather than stranding somebody on `/app`.
          returnTo={pathname || '/app/accounting'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialTab={status.connected ? 'about' : 'connections'}
        />
      )}
    </div>
  )
}
