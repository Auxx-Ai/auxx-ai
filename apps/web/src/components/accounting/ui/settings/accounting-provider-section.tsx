// apps/web/src/components/accounting/ui/settings/accounting-provider-section.tsx
'use client'

// Accounting > Settings > General: install, connect and status for the
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
import { Landmark } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType, useState } from 'react'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { useSettings } from '~/hooks/use-settings'
import {
  accountingProviderAppPath,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import {
  FREEZE_REASON,
  useAccountingSettingsFreeze,
} from '../../hooks/use-accounting-settings-freeze'
import { today } from '../journal/period-helpers'
import { ProviderSyncNowRow, ProviderSyncRunDetail } from '../provider-sync/provider-sync-panel'
import { ProviderSyncScheduleRow } from '../provider-sync/provider-sync-schedule-row'
import { AccountingDestinationPanel } from './accounting-destination-panel'
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
 * The accounting provider's install / connect / connected state, as one section.
 *
 * Three states, off `useAccountingProviderStatus()`:
 *
 * 1. Not installed - one row per catalogue provider: its install button and app page link.
 * 2. Installed, not connected - "Connect <provider>" opens `AppSettingsDialog` on
 *    its `connections` tab, which owns the whole OAuth flow.
 * 3. Connected - which company, who authorized it and when, plus Manage.
 *
 * Provider-only settings come from {@link PROVIDER_SETTINGS_ROWS}, under the connection rows.
 *
 * 🔑 The INBOUND sync lives here too (MK, 2026-09-17; brief 55 §4.8), as three
 * rows under the connection rather than the separate `Bring in entries` section
 * it replaced. Same connection, same page, one panel.
 *
 * 🛑 None of the three states is a warning. See the `P1` note at the top of this
 * file and in `use-accounting-provider-status.ts` before changing a badge colour.
 */
export function AccountingProviderSection() {
  const {
    installed,
    connected,
    providerLabel,
    providerEntry,
    installationType,
    connection,
    loading,
  } = useAccountingProviderStatus()
  const pathname = usePathname()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const { frozen } = useAccountingSettingsFreeze()
  const cutoffPeriod = (getSetting('accounting.cutoffPeriod') as string) || ''
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FALLBACK_BOOK_TIME_ZONE

  // The connection's label is written by the OAuth callback as `Company <realmId>`
  // - so the realm id IS the identifying fact, and showing both would print the
  // same sixteen digits twice. See the note on `AccountingProviderStatus.connection`
  // for why the company NAME is not available.
  const connectedAt = formatDate(connection?.connectedAt)
  const ProviderRows = providerEntry ? PROVIDER_SETTINGS_ROWS[providerEntry.id] : undefined

  return (
    <SettingsSection
      icon={Landmark}
      title='Accounting provider'
      description='Where posted entries are mirrored, and what is brought back from it. Optional - the ledger is kept here either way.'>
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
              description={`Posted entries are mirrored into ${providerEntry.label} and carry a deep link back.`}>
              <div className='flex w-full items-center justify-between gap-2'>
                <span className='flex items-center gap-2 text-sm'>
                  <Badge variant='green' size='xs'>
                    Connected
                  </Badge>
                  <span className='text-muted-foreground'>{providerLabel}</span>
                </span>
                <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                  Manage
                </Button>
              </div>
            </FieldPanelRow>

            <FieldPanelRow
              title='Company'
              description={`The ${providerEntry.shortLabel} company this authorization can access. The accounting company below controls where new fulfillment journals are assigned.`}>
              <div className='flex min-h-8 items-center gap-2 text-sm'>
                <span className='tabular-nums'>{connection?.label ?? '-'}</span>
                {connection?.global && (
                  <Badge variant='outline' size='xs'>
                    Organization-wide
                  </Badge>
                )}
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

            {ProviderRows && <ProviderRows />}

            {/*
              The INBOUND half, on the same panel as the outbound switch above
              it (MK, 2026-09-17). The three rows read in order: where the sync
              is allowed to start, how often it runs by itself, and the press.
            */}
            <FieldPanelRow
              title='Cutover date'
              description={
                frozen
                  ? `The month the previous system last closed. Everything up to the end of it is the opening entry, so the sync starts the month after and may never read below that. ${FREEZE_REASON}`
                  : 'The month the previous system last closed. Everything up to the end of it is the opening entry, so the sync starts the month after and may never read below that.'
              }>
              <div className='flex min-h-8 w-full items-center justify-between gap-2 text-sm'>
                <span className='tabular-nums'>{cutoffPeriod || 'Not set'}</span>
                {/* Read-only here in both cases, and a link rather than a second
                    editor: this key is in `FROZEN_SETUP_SETTING_KEYS`, so its one
                    write door stays the Accounting period section that owns the
                    freeze copy and the month validation. */}
                {!frozen && (
                  <Link
                    href='/app/accounting/settings/general'
                    className='text-muted-foreground text-xs hover:underline'>
                    Change it in Accounting period
                  </Link>
                )}
              </div>
            </FieldPanelRow>

            <ProviderSyncScheduleRow />

            <ProviderSyncNowRow todayInBooks={today(bookTimeZone)} />
          </>
        )}
      </FieldPanel>

      {/* What the last or current run found, under the rows that started it. */}
      {installed && connected && <ProviderSyncRunDetail />}

      {installed && <AccountingDestinationPanel />}

      {!connected && <p className='text-muted-foreground text-xs'>{NOT_CONNECTED_COPY}</p>}

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
    </SettingsSection>
  )
}
