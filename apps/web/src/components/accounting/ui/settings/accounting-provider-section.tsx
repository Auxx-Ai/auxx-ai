// apps/web/src/components/accounting/ui/settings/accounting-provider-section.tsx
'use client'

// Accounting > Settings > Connected system: install, connect, export and sync for the
// accounting provider (14-drive-the-close.md §4).
//
// 🛑 Keep the tone. Decision `P1` makes "nothing connected" a FIRST-CLASS
// outcome: the entry is still built, balanced and persisted, and the result is
// `not_connected` rather than a failure. The install button is discoverability -
// no destructive variant, no "action required", no checklist goal.
// `getting-started.ts` records that `connect-quickbooks` is deliberately not a
// goal, and that decision stands.
//
// Connect and Manage open `AppSettingsDialog` rather than navigating, so nobody is
// dropped out of the module mid-setup. The app detail page is linked only from the
// not-installed rows, where it is a browse action.

import { ACCOUNTING_PROVIDER_CATALOGUE } from '@auxx/lib/accounting/providers/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { History, Landmark, RefreshCw, Upload } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType, useState } from 'react'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { Tooltip } from '~/components/global/tooltip'
import { useSettings } from '~/hooks/use-settings'
import {
  accountingProviderAppPath,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import { today } from '../journal/period-helpers'
import { ProviderSyncNowRow, ProviderSyncRunDetail } from '../provider-sync/provider-sync-panel'
import { ProviderSyncScheduleRow } from '../provider-sync/provider-sync-schedule-row'
import {
  DestinationEditor,
  DestinationRow,
  PreviousCompanyRows,
  useAccountingDestination,
} from './accounting-destination-panel'
import { QuickbooksSettingsRows } from './quickbooks-settings-rows'

/** Settings only one provider has, keyed by catalogue id and rendered under its connection rows. */
const PROVIDER_SETTINGS_ROWS: Record<string, ComponentType> = {
  quickbooks: QuickbooksSettingsRows,
}

/** Same fallback `useLedgerPeriod` uses when the book timezone is unset. */
const FALLBACK_BOOK_TIME_ZONE = 'UTC'

/** What "none connected" actually means, spelled the same way everywhere. */
const NOT_CONNECTED_COPY =
  'Entries are still built, balanced and stored here. Nothing is blocked by this.'

/** `12 Aug 2026`, or nothing at all rather than an `Invalid Date`. */
function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The accounting provider page body: Connection, Export, Sync and Previous companies.
 *
 * Three states, off `useAccountingProviderStatus()`:
 *
 * 1. Not installed - one row per catalogue provider: its install button and app page link.
 * 2. Installed, not connected - "Connect <provider>" opens `AppSettingsDialog` on
 *    its `connections` tab, which owns the whole OAuth flow.
 * 3. Connected - the company, who authorized it, the export start, then Export and Sync.
 *
 * 🛑 None of the three states is a warning. See the `P1` note at the top of this
 * file and in `use-accounting-provider-status.ts` before changing a badge colour.
 */
export function AccountingProviderSection() {
  const { installed, connected, providerEntry, installationType, connection, loading } =
    useAccountingProviderStatus()
  const pathname = usePathname()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const cutoffPeriod = (getSetting('accounting.cutoffPeriod') as string) || ''
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FALLBACK_BOOK_TIME_ZONE
  const destination = useAccountingDestination()

  const connectedAt = formatDate(connection?.connectedAt)
  const ProviderRows = providerEntry ? PROVIDER_SETTINGS_ROWS[providerEntry.id] : undefined
  const companyId = destination.current?.companyId

  return (
    <>
      <SettingsSection
        icon={Landmark}
        title='Connection'
        description='Where posted entries are mirrored, and what is brought back from it. Optional - the ledger is kept here either way.'
        action={
          providerEntry &&
          connected && (
            <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
              Manage
            </Button>
          )
        }>
        <FieldPanel className='mt-1 p-0' resizeId='accounting-provider'>
          {!installed &&
            ACCOUNTING_PROVIDER_CATALOGUE.map((entry) => (
              <FieldPanelRow
                key={entry.id}
                title={entry.label}
                description={
                  loading ? 'Checking installed apps.' : 'Install the app to mirror posted entries.'
                }>
                <div className='flex w-full items-center justify-between gap-2'>
                  <Link href={accountingProviderAppPath(entry)} className='text-sm hover:underline'>
                    {entry.shortLabel}
                  </Link>
                  <InlineAppInstallButton appSlug={entry.appSlug} />
                </div>
              </FieldPanelRow>
            ))}

          {providerEntry && !connected && (
            <FieldPanelRow
              title={providerEntry.label}
              description={`Installed. Authorize your ${providerEntry.shortLabel} company to mirror posted entries.`}>
              <div className='flex w-full items-center justify-between gap-2'>
                <Badge variant='outline' size='xs'>
                  Not connected
                </Badge>
                <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                  Connect {providerEntry.shortLabel}
                </Button>
              </div>
            </FieldPanelRow>
          )}

          {providerEntry && connected && (
            <>
              <FieldPanelRow
                title={providerEntry.label}
                description={`Posted entries are mirrored into this ${providerEntry.shortLabel} company and carry a deep link back.`}>
                <div className='flex min-h-8 min-w-0 items-center gap-2 text-sm'>
                  <Badge variant='green' size='xs' className='shrink-0'>
                    Connected
                  </Badge>
                  <Tooltip content={companyId ? `Company ID ${companyId}` : undefined}>
                    <span className='truncate'>{connection?.label ?? '-'}</span>
                  </Tooltip>
                </div>
              </FieldPanelRow>

              <FieldPanelRow
                title='Authorized'
                description='Who authorized this connection, and when. Re-authorizing is done from Manage.'>
                <div className='flex min-h-8 items-center text-muted-foreground text-sm'>
                  {connection?.connectedBy
                    ? `${connection.connectedBy}${connectedAt ? ` · ${connectedAt}` : ''}`
                    : (connectedAt ?? '-')}
                </div>
              </FieldPanelRow>

              <DestinationRow destination={destination} />
            </>
          )}
        </FieldPanel>

        {!destination.repairId && <DestinationEditor destination={destination} />}

        {!connected && <p className='text-muted-foreground text-xs'>{NOT_CONNECTED_COPY}</p>}
      </SettingsSection>

      {connected && ProviderRows && (
        <SettingsSection icon={Upload} title='Export'>
          <FieldPanel className='mt-1 p-0' resizeId='accounting-provider'>
            <ProviderRows />
          </FieldPanel>
        </SettingsSection>
      )}

      {providerEntry && connected && (
        <SettingsSection
          icon={RefreshCw}
          title={`Sync from ${providerEntry.shortLabel}`}
          description={`Bring the entries your accountant authors in ${providerEntry.shortLabel} into these books.`}>
          <FieldPanel className='mt-1 p-0' resizeId='accounting-provider'>
            <ProviderSyncScheduleRow />
            <ProviderSyncNowRow todayInBooks={today(bookTimeZone)} cutoverPeriod={cutoffPeriod} />
          </FieldPanel>
          {/* What the last or current run found, under the rows that started it. */}
          <ProviderSyncRunDetail />
        </SettingsSection>
      )}

      {installed && destination.canControl && destination.previous.length > 0 && (
        <SettingsSection
          icon={History}
          title='Previous companies'
          description='Companies this ledger exported to before. Restoring one keeps its original dates and assigned journals.'>
          <FieldPanel className='mt-1 p-0' resizeId='accounting-provider'>
            <PreviousCompanyRows destination={destination} />
          </FieldPanel>
          {destination.repairId && <DestinationEditor destination={destination} />}
        </SettingsSection>
      )}

      {/* Mounted only once installed: the dialog's settings queries need an
          `installationType`, and until then there is nothing to manage. */}
      {providerEntry && installationType && (
        <AppSettingsDialog
          appSlug={providerEntry.appSlug}
          installationType={installationType}
          // The safety net for the popup-blocked -> full-page-redirect fallback
          // that cannot be fully prevented: come back to the accounting settings
          // page, not to /app.
          returnTo={pathname || '/app/accounting/settings/general'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialTab={connected ? 'about' : 'connections'}
        />
      )}
    </>
  )
}
