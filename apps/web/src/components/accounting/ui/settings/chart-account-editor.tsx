// apps/web/src/components/accounting/ui/settings/chart-account-editor.tsx
'use client'

// The right column of the Chart of accounts tab: what the selected `gl_account`
// row says.
//
// 🛑 A READ-ONLY PANE, not a disabled form. There is no create or update
// procedure for a `gl_account` behind any surface yet - `ledger.chartAccounts`
// reads, and nothing writes - so this pane renders values, never inputs. The
// previous version was an autosaving `FieldInputAdapter` form plus a phantom
// draft that created rows in local React state; both have been removed rather
// than disabled, because the failure mode to avoid is somebody typing into a
// field whose work is silently discarded, and a field that merely LOOKS disabled
// is one prop away from doing exactly that again.
//
// When the `gl_account` record path lands (the generic resource CRUD already has
// `resources/registry/resources/gl-account-fields.ts`), the honest move is to
// link this pane at the record detail view rather than to grow a second door.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  type ChartAccountRow,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { accountTypeColor, accountTypeLabel } from './accounts-types'

/**
 * ⚠️ Renumbering does NOT rewrite history, and this pane says so because a
 * person reading a code here is the person who would go and change it. A posting
 * line names an account by CODE with no foreign key, deliberately, so the ledger
 * outlives the chart - which means a renumber silently detaches every line
 * already posted from the row on screen.
 */
const RENUMBER_NOTE =
  'A posted line stores the account code with no foreign key, on purpose, so the ledger ' +
  'outlives the chart. Renumbering an account leaves every line already posted holding the ' +
  'old code.'

interface ChartAccountDetailProps {
  selectedId: string | null
  accounts: ChartAccountRow[]
  /** Posting roles currently pointed at this account. */
  roles: AccountRole[]
}

export function ChartAccountDetail({ selectedId, accounts, roles }: ChartAccountDetailProps) {
  const account = selectedId ? accounts.find((row) => row.id === selectedId) : undefined

  if (!account) {
    return <div className='p-4 text-muted-foreground text-sm'>Select an account to see it.</div>
  }

  return (
    // `min-h-0` + `ScrollArea`: this pane sits inside a sticky container capped
    // at the viewport height (`accounts-settings-page.tsx`), so content taller
    // than that must scroll ITSELF. Without this it is clipped with no
    // indication there is anything below.
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <FieldPanel
          orientation='horizontal'
          breakpoint='md'
          resizeId='gl-account-detail'
          defaultLabelWidth={160}
          className='shrink-0 grow-0 p-0'>
          <FieldPanelRow title='Code' type={BaseType.STRING} showIcon>
            <div className='flex min-h-8 items-center text-sm tabular-nums'>{account.code}</div>
          </FieldPanelRow>

          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon>
            <div className='flex min-h-8 items-center text-sm'>{account.name}</div>
          </FieldPanelRow>

          <FieldPanelRow
            title='Type'
            type={BaseType.ENUM}
            showIcon
            description='The statement classification. A role can only be mapped to an account of the type it declares.'>
            <div className='flex min-h-8 items-center'>
              <Badge variant={accountTypeColor(account.accountType)} size='xs'>
                {accountTypeLabel(account.accountType)}
              </Badge>
            </div>
          </FieldPanelRow>

          <FieldPanelRow title='Active' type={BaseType.BOOLEAN} showIcon>
            <div className='flex min-h-8 items-center'>
              <Badge variant={account.isActive ? 'green' : 'outline'} size='xs'>
                {account.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </FieldPanelRow>

          <FieldPanelRow
            title='Roles'
            type={BaseType.STRING}
            showIcon
            description='Posting roles that resolve to this account. Change them on the Roles tab.'>
            <div className='flex min-h-8 items-center text-sm'>
              {roles.length === 0 ? (
                <span className='text-muted-foreground'>No role posts here</span>
              ) : (
                <span>{roles.map((role) => ACCOUNT_ROLE_LABELS[role]).join(', ')}</span>
              )}
            </div>
          </FieldPanelRow>
        </FieldPanel>

        <div className='mt-3 space-y-1 rounded-xl border p-3'>
          <p className='font-medium text-sm'>The chart is not editable here yet</p>
          <p className='text-muted-foreground text-xs'>
            Adding, renaming and renumbering accounts arrives with the account record path. Until
            then this pane reads the chart, and the Roles tab decides where each posting role lands.{' '}
            {RENUMBER_NOTE}
          </p>
        </div>
      </ScrollArea>
    </div>
  )
}
