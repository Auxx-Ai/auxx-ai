// apps/web/src/components/accounting/ui/settings/quickbooks-settings-rows.tsx
'use client'

import { SettingsFieldRow } from '~/components/settings/settings-field-row'

/**
 * QuickBooks-only settings, rendered inside the connected-system panel when QuickBooks is the
 * connected provider. `quickbooks.postJournalEntries` is read only by the QuickBooks adapter.
 *
 * Autosaves through an uncontrolled `SettingsFieldRow`; its catalog scope is `DOCUMENTS`, so wiring
 * it to the page's `scope: 'GENERAL'` draft would render it permanently off.
 */
export function QuickbooksSettingsRows() {
  return (
    <SettingsFieldRow
      settingKey='quickbooks.postJournalEntries'
      title='Export posted entries'
      description='When on, new fulfillment journals are exported automatically. When off, they wait for manual export. Previously assigned exports keep their saved setting.'
    />
  )
}
