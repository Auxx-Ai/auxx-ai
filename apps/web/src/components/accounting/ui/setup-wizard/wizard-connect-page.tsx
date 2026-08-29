// apps/web/src/components/accounting/ui/setup-wizard/wizard-connect-page.tsx
'use client'

// Page 6 of `AccountingSetupWizard` - connect the accounting system, immediately
// before the page that maps the chart onto it.
//
// 🛑 THIS STEP IS SKIPPABLE, AND IT MUST STAY SKIPPABLE. Decision `P1` makes
// "nothing connected" a first-class outcome: entries are still built, balanced
// and persisted, and the result is `not_connected` rather than a failure. So
// this page has no destructive variant, no "action required", and Continue is
// never blocked - `quickbooks-section.tsx` carries the same instruction for the
// same reason, and `getting-started.ts` records that `connect-quickbooks` is
// deliberately not a checklist goal.
//
// What the step DOES earn its place with is ordering. The next page cannot show
// a single row until a provider chart exists to map against, so connecting has
// to happen before it rather than in a settings page somebody visits later.
//
// 🛑 CONNECT AND MANAGE OPEN `AppSettingsDialog`, they do not navigate - the
// same call `quickbooks-section.tsx` makes. Sending somebody to
// `/app/settings/apps/quickbooks` from inside a wizard drops them out of it
// mid-setup with no way back but the browser button, and the dialog is where the
// OAuth flow lives anyway.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Landmark } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'

/**
 * Install / connect / connected, as one wizard page.
 *
 * Three states off `useAccountingProviderStatus()`, none of them a failure:
 *
 * 1. not installed - an install button, and the honest note that skipping is fine
 * 2. installed, not connected - "Connect QuickBooks" opens the OAuth dialog
 * 3. connected - which company, and what the next page will do with it
 */
export function WizardConnectPage() {
  const status = useAccountingProviderStatus()
  const pathname = usePathname()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Auxx keeps the ledger either way - entries are built, balanced and stored here whether or
        not an accounting system is connected. Connecting one lets Auxx also push each month's
        journal entry to it.
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
                {status.connection?.label ?? 'Connected'}. On the next page you will say which
                account in QuickBooks each of your accounts corresponds to.
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
                Not installed. You can add it now, or skip this and set it up later - nothing on the
                remaining pages depends on it.
              </p>
              <div>
                <InlineAppInstallButton appSlug='quickbooks' />
              </div>
            </>
          )}
        </div>
      )}

      <p className='text-muted-foreground text-xs'>
        Nothing is pushed to QuickBooks until you post a month, and posting is off until you turn it
        on in Accounting settings.
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
