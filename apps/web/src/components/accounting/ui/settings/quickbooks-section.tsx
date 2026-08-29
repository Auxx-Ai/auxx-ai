// apps/web/src/components/accounting/ui/settings/quickbooks-section.tsx
'use client'

// Accounting > Settings > General: install, connect and status for the
// accounting provider (14-drive-the-close.md §4).
//
// The module could be fully set up with no way to reach the provider from
// anywhere inside it, and the status display that did exist was buried on the
// Accounts > Role map tab, where it is a non sequitur. This section is that
// display plus the two actions, copied from
// `~/components/money/ui/settings/quickbooks-section.tsx`.
//
// 🛑 Keep the tone. Decision `P1` makes "nothing connected" a FIRST-CLASS
// outcome: the entry is still built, balanced and persisted, and the result is
// `not_connected` rather than a failure. The install button is discoverability -
// no destructive variant, no "action required", no checklist goal.
// `getting-started.ts` records that `connect-quickbooks` is deliberately not a
// goal, and that decision stands.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Landmark } from 'lucide-react'
import Link from 'next/link'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'

/** What "none connected" actually means, spelled the same way everywhere. */
const NOT_CONNECTED_COPY =
  'Entries are still built, balanced and stored here. Nothing is blocked by this.'

/**
 * The accounting provider's install / connect / connected state, as one section.
 *
 * Three states, off `useAccountingProviderStatus()`:
 *
 * 1. Not installed - an `InlineAppInstallButton` and a link to the app detail page.
 * 2. Installed, not connected - a "Connect QuickBooks" button pointing at the app
 *    detail page, where the OAuth flow lives. Connecting is not done from here.
 * 3. Connected - the provider name, and what being connected changes.
 *
 * 🛑 This section owns NO settings values. It is presentational plus two
 * navigation actions, so it stays outside the page's `useDirtyDraft` slices and
 * adds nothing to `DRAFT_KEYS`.
 *
 * 🛑 None of the three states is a warning. See the `P1` note at the top of this
 * file and in `use-accounting-provider-status.ts` before changing a badge colour.
 */
export function QuickbooksSettingsSection() {
  const { installed, connected, providerLabel, appDetailPath, loading } =
    useAccountingProviderStatus()

  return (
    <SettingsSection
      icon={Landmark}
      title='Accounting provider'
      description='Where posted entries are mirrored. Optional - the ledger is kept here either way.'>
      <FieldPanel className='mt-1 p-0' resizeId='accounting-general-quickbooks'>
        {!installed && (
          <FieldPanelRow
            title='QuickBooks Online'
            description={
              loading ? 'Checking installed apps.' : 'Install the app to mirror posted entries.'
            }>
            <div className='flex w-full items-center justify-between gap-2'>
              <Link href={appDetailPath} className='text-sm hover:underline'>
                QuickBooks
              </Link>
              <InlineAppInstallButton appSlug='quickbooks' />
            </div>
          </FieldPanelRow>
        )}

        {installed && !connected && (
          <FieldPanelRow
            title='QuickBooks Online'
            description='Installed. Authorize your QuickBooks company to mirror posted entries.'>
            <div className='flex w-full items-center justify-between gap-2'>
              <Badge variant='outline' size='xs'>
                Not connected
              </Badge>
              <Button variant='outline' size='sm' asChild>
                <Link href={appDetailPath}>Connect QuickBooks</Link>
              </Button>
            </div>
          </FieldPanelRow>
        )}

        {installed && connected && (
          <FieldPanelRow
            title='QuickBooks Online'
            description='Posted entries are mirrored into QuickBooks Online and carry a deep link back.'>
            <div className='flex w-full items-center justify-between gap-2'>
              <span className='flex items-center gap-2 text-sm'>
                <Badge variant='green' size='xs'>
                  Connected
                </Badge>
                <span className='text-muted-foreground'>{providerLabel}</span>
              </span>
              <Button variant='outline' size='sm' asChild>
                <Link href={appDetailPath}>Manage</Link>
              </Button>
            </div>
          </FieldPanelRow>
        )}
      </FieldPanel>

      {!connected && <p className='text-muted-foreground text-xs'>{NOT_CONNECTED_COPY}</p>}
    </SettingsSection>
  )
}
