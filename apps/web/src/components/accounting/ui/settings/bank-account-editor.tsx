// apps/web/src/components/accounting/ui/settings/bank-account-editor.tsx
'use client'

// The right pane of Accounting > Settings > Bank accounts (ui-plan.md §2.7).
//
// 🛑 The GL account row is the reason this screen exists. Everything else here
// is either what the bank said or what the connector is doing; the mapping is
// the one decision a person makes, and it decides where cash lands on the
// balance sheet.
//
// 🛑 The picker is filtered to `asset` for a depository account and `liability`
// for a credit one, and the credit-sign warning from bank plan 02 §6 is the
// row's description rather than a toast. A card mapped to an asset account
// produces a balance sheet that BALANCES and is wrong by twice the card
// balance, which nothing downstream can detect - LFK's QuickBooks card sits at
// -$570,855.81 against a real $29,701.88, which is what two years of that looks
// like. The filter is a convenience; the sentence is the actual defence.
//
// 🛑 Coverage is a read-only row and it is not decoration. A balance sheet
// spanning a hole renders happily and is wrong: arithmetically right,
// financially meaningless, and silent. plans/bank-connection/01 §4.1 calls the
// coverage record "the one most likely to be skipped"; putting it on the row a
// person already has open is what keeps it from being skipped.

import { FieldType } from '@auxx/database/enums'
import type { BankAccountCoverage, BankAccountRow } from '@auxx/lib/banking/client'
import {
  BANK_ACCOUNT_GL_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  CREDIT_SIGN_WARNING,
} from '@auxx/lib/banking/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { PlugZap, RefreshCw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { ConnectorRunsPanel } from '~/components/data-connectors/ui/connector-runs-panel'
import { asConnectorStatus } from '~/components/data-connectors/ui/connector-status'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { accountTitle } from './bank-accounts-list'

/** Whether this account's feed needs re-authenticating at the bank. */
function needsReconnect(account: BankAccountRow): boolean {
  return (
    account.status === 'disconnected' ||
    account.connector?.status === 'disconnected' ||
    account.connector?.status === 'error'
  )
}

const TYPE_OPTIONS = [
  { value: 'depository', label: BANK_ACCOUNT_TYPE_LABELS.depository, color: 'blue' as const },
  { value: 'credit', label: BANK_ACCOUNT_TYPE_LABELS.credit, color: 'amber' as const },
]

/** The import route a coverage gap points at. */
const IMPORT_HREF = '/app/accounting/banking/import'

export interface BankAccountPatch {
  name?: string
  institution?: string | null
  last4?: string | null
  type?: 'depository' | 'credit'
  currency?: string | null
  glAccountCode?: string | null
  feedStartDate?: string | null
}

interface BankAccountEditorProps {
  account: BankAccountRow | null
  coverage: BankAccountCoverage | null
  coverageLoading: boolean
  /**
   * True while an `update` is in flight - the field rows and their Save.
   *
   * 🛑 Separate from {@link disconnecting}. One flag over both put the Save
   * button into its spinner while a disconnect ran, which reads as "your edit
   * is being saved" over a write that is not happening.
   */
  pending: boolean
  /** True while the disconnect is in flight. Drives the danger-zone button alone. */
  disconnecting?: boolean
  /** True while a manual sync is being queued. */
  syncing?: boolean
  onPatch: (patch: BankAccountPatch) => void
  /** Queue a manual sync for this account's feed. */
  onSync?: () => void
  /** Re-authenticate at the bank. Same flow as connecting. */
  onReconnect?: () => void
  onDisconnect: () => void
}

export function BankAccountEditor({
  account,
  coverage,
  coverageLoading,
  pending,
  disconnecting = false,
  syncing = false,
  onPatch,
  onSync,
  onReconnect,
  onDisconnect,
}: BankAccountEditorProps) {
  // Text rows buffer locally and commit on blur. Committing per keystroke would
  // fire a write per character on a field a person is halfway through typing,
  // and every one of them refuses `last4` until the fourth digit lands.
  const [draft, setDraft] = useState<{ id: string; values: BankAccountPatch } | null>(null)
  const values: BankAccountPatch = draft && account && draft.id === account.id ? draft.values : {}

  if (!account) {
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        Select an account to map it to your chart, or connect a bank to add one.
      </div>
    )
  }

  // 🛑 Connector-owned identity: the feed rewrites these on every sync, so an
  // edit here would silently revert. `updateBankAccount` refuses them server
  // side; disabling the inputs is what stops somebody typing into a field that
  // is about to reject them.
  const isConnected = account.connectorId != null
  const glFilterTypes = [BANK_ACCOUNT_GL_TYPES[account.type]]

  const buffer = (patch: BankAccountPatch) =>
    setDraft({ id: account.id, values: { ...values, ...patch } })

  // 🛑 PRESENCE, not nullishness. `buffer` writes `null` for a cleared text
  // field, and a `??` chain reads that null as "nothing buffered" and falls
  // straight back to the stored value - so Last four, Institution and Currency
  // could be typed into but never emptied.
  const text = (key: 'name' | 'institution' | 'last4' | 'currency') =>
    (key in values ? values[key] : account[key]) ?? ''

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3'>
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='truncate font-medium text-sm'>{accountTitle(account)}</span>
        <span className='text-muted-foreground text-xs'>
          {isConnected
            ? 'Connected. Name, institution, last four, type and currency come from the bank.'
            : 'Added by hand. Import statements into it, or connect the bank to pull them.'}
        </span>
      </div>

      <FieldPanel
        className='shrink-0 grow-0 p-0'
        resizeId='accounting-bank-account'
        defaultLabelWidth={150}>
        <FieldPanelRow title='Institution' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={text('institution')}
            disabled={isConnected || pending}
            placeholder='Bank of America'
            onChange={(value) => buffer({ institution: (value as string) || null })}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={text('name')}
            disabled={isConnected || pending}
            placeholder='Business Adv Relationship'
            onChange={(value) => buffer({ name: (value as string) || '' })}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Last four'
          type={BaseType.STRING}
          showIcon
          description='Digits only. A leading zero is part of the number, so it is stored as text.'>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={text('last4')}
            disabled={isConnected || pending}
            placeholder='5381'
            onChange={(value) => buffer({ last4: (value as string) || null })}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Type'
          type={BaseType.ENUM}
          showIcon
          description='A credit account is a liability. Changing this changes which accounts the mapping below offers.'>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: TYPE_OPTIONS }}
            value={values.type ?? account.type}
            disabled={isConnected || pending}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            placeholder='Select type'
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              if (next === 'depository' || next === 'credit') onPatch({ type: next })
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Currency' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={text('currency')}
            disabled={isConnected || pending}
            placeholder='USD'
            onChange={(value) => buffer({ currency: (value as string) || null })}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='GL account'
          type={BaseType.STRING}
          showIcon
          isRequired
          description={
            account.type === 'credit'
              ? CREDIT_SIGN_WARNING
              : 'Where this account’s money lives in your chart. Every reconciliation and the cash figure on your balance sheet read this.'
          }>
          <GlAccountPicker
            value={account.glAccountCode}
            filterTypes={glFilterTypes}
            disabled={pending}
            placeholder='Map to an account…'
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            onChange={(code) => onPatch({ glAccountCode: code })}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Feed start'
          type={BaseType.DATE}
          showIcon
          description='The earliest date you trust on this account. Rows before it are held but never booked.'>
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            value={account.feedStartDate ? `${account.feedStartDate}T00:00:00.000Z` : null}
            disabled={pending}
            onChange={(value) => {
              const iso = value as string | null
              onPatch({ feedStartDate: iso ? iso.slice(0, 10) : null })
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Coverage' type={BaseType.DATE} showIcon>
          <CoverageRow coverage={coverage} isLoading={coverageLoading} />
        </FieldPanelRow>

        {account.connector && (
          <>
            <FieldPanelRow title='Last synced' type={BaseType.DATETIME} showIcon>
              <div className='flex min-h-8 items-center text-sm'>
                {account.connector.lastSyncedAt ? (
                  <LastUpdated timestamp={account.connector.lastSyncedAt} />
                ) : (
                  <span className='text-muted-foreground'>Never</span>
                )}
              </div>
            </FieldPanelRow>
            <FieldPanelRow
              title='Last webhook'
              type={BaseType.DATETIME}
              showIcon
              description='A webhook sync writes no run, so this is the only sign of life when nothing changed.'>
              <div className='flex min-h-8 items-center text-sm'>
                {account.connector.lastWebhookEventAt ? (
                  <LastUpdated timestamp={account.connector.lastWebhookEventAt} />
                ) : (
                  <span className='text-muted-foreground'>Never</span>
                )}
              </div>
            </FieldPanelRow>
            <FieldPanelRow title='Transactions' type={BaseType.NUMBER} showIcon>
              <div className='flex min-h-8 items-center font-mono text-sm tabular-nums'>
                {account.connector.itemCount}
              </div>
            </FieldPanelRow>
          </>
        )}
      </FieldPanel>

      {/* The text rows commit together: one write for whatever was typed, rather
          than one per field, so a rename plus a last-four fix is one refusal
          surface instead of two. */}
      {draft?.id === account.id && Object.keys(draft.values).length > 0 && (
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            loading={pending}
            onClick={() => {
              onPatch(draft.values)
              setDraft(null)
            }}>
            Save changes
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      )}

      {/* 🛑 Sync now is DISABLED on a disconnected feed, not hidden. One click on a
          disconnected connector moves it to `error`, which discards the Disconnected
          banner and puts it outside every repair path permanently (#2051) - so the
          server refuses it and the button explains before the click. Reconnect is what
          actually helps, so it sits beside it and only appears when it would. */}
      {isConnected && (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            loading={syncing}
            loadingText='Syncing...'
            disabled={account.status === 'disconnected'}
            onClick={onSync}>
            <RefreshCw />
            Sync now
          </Button>
          {needsReconnect(account) && (
            <Button variant='outline' size='sm' onClick={onReconnect}>
              <PlugZap />
              Reconnect
            </Button>
          )}
          {account.status === 'disconnected' && (
            <span className='text-muted-foreground text-xs'>
              This feed is disconnected. Reconnect the bank to start it again - every transaction
              already synced is kept.
            </span>
          )}
        </div>
      )}

      {account.connector && (
        <Section title='Runs' initialOpen={false}>
          <ConnectorRunsPanel
            connectorId={account.connector.id}
            initialStatus={asConnectorStatus(account.connector.status)}
            sourceLabel={account.institution ?? account.connector.name}
          />
        </Section>
      )}

      {isConnected && (
        <Section title='Danger zone' initialOpen={false}>
          <div className='flex flex-col gap-2 p-1'>
            <p className='text-muted-foreground text-xs'>
              Disconnecting stops the feed and keeps every transaction, including the ones already
              coded and posted. A posted bank line is the source document of a journal entry, so
              nothing here is ever deleted.
            </p>
            <div>
              <Button
                variant='destructive'
                size='sm'
                loading={disconnecting}
                onClick={onDisconnect}>
                <PlugZap />
                Disconnect
              </Button>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}

/**
 * `coverageFrom` and the gaps.
 *
 * ⚠️ Every gap says "possible" and links to the importer. The derivation cannot
 * tell a hole in our data from a quiet fortnight at the bank - only the
 * statement knows, and the statement is the thing we do not have - so the copy
 * has to be honest about that or people will start ignoring the badges.
 */
function CoverageRow({
  coverage,
  isLoading,
}: {
  coverage: BankAccountCoverage | null
  isLoading: boolean
}) {
  if (isLoading) {
    return <div className='flex min-h-8 items-center text-muted-foreground text-sm'>Loading…</div>
  }
  if (!coverage || !coverage.coverageFrom) {
    return (
      <div className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Nothing imported or synced yet.
      </div>
    )
  }

  return (
    <div className='flex min-h-8 flex-col justify-center gap-1.5 py-1'>
      <span className='text-sm'>
        Data from <span className='font-mono tabular-nums'>{coverage.coverageFrom}</span>
        <span className='text-muted-foreground'>
          {' '}
          ({coverage.transactionCount}{' '}
          {coverage.transactionCount === 1 ? 'transaction' : 'transactions'})
        </span>
      </span>
      {coverage.gaps.length === 0 ? (
        <span className='text-muted-foreground text-xs'>No gaps found.</span>
      ) : (
        <div className='flex flex-col gap-1'>
          {coverage.gaps.map((gap) => (
            <div
              key={`${gap.from}-${gap.to}`}
              className={cn('flex flex-wrap items-center gap-1.5')}>
              <Badge variant='destructive' size='xs'>
                <TriangleAlert className='size-3' />
                <span className='font-mono tabular-nums'>
                  {gap.from} → {gap.to}
                </span>
              </Badge>
              <Link className='text-xs underline' href={IMPORT_HREF}>
                Import statements for this range
              </Link>
            </div>
          ))}
          <span className='text-muted-foreground text-xs'>
            Possible gaps: more than a week with no transaction. A genuinely quiet account will show
            these too.
          </span>
        </div>
      )}
    </div>
  )
}
