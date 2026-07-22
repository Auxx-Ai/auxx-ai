// apps/web/src/components/money/ui/settings/quickbooks-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Landmark } from 'lucide-react'
import Link from 'next/link'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'

const QUICKBOOKS_APP_SLUG = 'quickbooks'
const QUICKBOOKS_APP_DETAIL_PATH = '/app/settings/apps/quickbooks'

type ControlledFieldProps = { value: unknown; onChange: (value: unknown) => void }

/**
 * QuickBooks section for the invoicing settings page (37e-quickbooks-invoice-sync.md P1).
 * Renders one of three states, detected client-side off `useAppsContext()` — the app is
 * never auto-installed, every state points at an explicit user action:
 *
 * 1. Not installed → install row (mirrors the "Required Apps" row in
 *    `workflow-template-dialog.tsx`), title links to the app detail page.
 * 2. Installed, no QBO connection → a "Connect QuickBooks" prompt linking to the app detail
 *    page (connecting is a full OAuth flow, out of scope here).
 * 3. Connected → the `quickbooks.syncInvoices` toggle + default income account input, riding
 *    the parent page's batched draft/save.
 */
export function QuickbooksSettingsSection({
  syncInvoices,
  defaultIncomeAccountId,
}: {
  syncInvoices: ControlledFieldProps
  defaultIncomeAccountId: ControlledFieldProps
}) {
  const { appInstallations, appConnections } = useAppsContext()

  const installation = appInstallations.find((inst) => inst.app.slug === QUICKBOOKS_APP_SLUG)
  // A connection identifies its app via `appId` (see `AppConnection` in apps-context.tsx,
  // sourced from `listAppConnections` — `cred.appId` matched against the App table). We
  // match on the installed app's id rather than name/slug since connections don't carry slug.
  const isConnected = installation
    ? appConnections.some(
        (conn) => conn.appId === installation.app.id && conn.connectionStatus === 'connected'
      )
    : false

  return (
    <SettingsSection
      icon={Landmark}
      title='QuickBooks'
      description='Mirror sent invoices into QuickBooks Online.'>
      {!installation && (
        <FieldPanel className='mt-1 p-0' resizeId='invoicing-quickbooks-settings'>
          <FieldPanelRow
            title='QuickBooks Online'
            description='Install the app to enable invoice sync.'>
            <div className='flex w-full items-center justify-between gap-2'>
              <Link href={QUICKBOOKS_APP_DETAIL_PATH} className='text-sm hover:underline'>
                QuickBooks
              </Link>
              <InlineAppInstallButton appSlug={QUICKBOOKS_APP_SLUG} />
            </div>
          </FieldPanelRow>
        </FieldPanel>
      )}

      {installation && !isConnected && (
        <FieldPanel className='mt-1 p-0' resizeId='invoicing-quickbooks-settings'>
          <FieldPanelRow
            title='QuickBooks Online'
            description='Connect your QuickBooks Online company to enable invoice sync.'>
            <Button variant='outline' size='sm' asChild>
              <Link href={QUICKBOOKS_APP_DETAIL_PATH}>Connect QuickBooks</Link>
            </Button>
          </FieldPanelRow>
        </FieldPanel>
      )}

      {installation && isConnected && (
        <FieldPanel
          className='mt-1 p-0'
          resizeId='invoicing-quickbooks-settings'
          defaultLabelWidth={220}>
          <SettingsFieldRow
            settingKey='quickbooks.syncInvoices'
            title='Sync invoices to QuickBooks'
            {...syncInvoices}
          />
          <SettingsFieldRow
            settingKey='quickbooks.defaultIncomeAccountId'
            title='Default income account'
            {...defaultIncomeAccountId}
          />
        </FieldPanel>
      )}
    </SettingsSection>
  )
}
