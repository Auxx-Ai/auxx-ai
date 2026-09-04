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
// person already has open is what keeps it from being skipped. Each gap deep
// links into the importer WITH THIS ACCOUNT ALREADY CHOSEN - the import page
// reads `?account=<id>` into its own `nuqs` state - because the account is the
// one thing a statement file never says, and asking for it again on the screen
// you were just sent to is how a gap gets abandoned.
//
// ── ONE SAVE MODEL: every row commits on change ─────────────────────────────
//
// 🛑 This panel used to run two. Type and GL account wrote the moment you picked
// them; Institution, Name, Last four and Currency buffered into a local draft
// behind a Save button. So a person who remapped the account and then fixed its
// name saw a Save button over an edit that was already half-written, and a
// person who typed a name and clicked another account in the master list lost
// it silently - there is no dirty guard on this pane and a master-detail split
// has nowhere to put one.
//
// Commit-on-change is what the neighbouring record editor in this folder does
// (`chart-account-editor.tsx`, per-field through `ledger.chartAccountUpdate`,
// text rows debounced), and it is the model that survives the list selection
// changing under the pane. The section-shaped settings pages here
// (`general-settings-page`, `opening-settings-page`) keep `FormSaveBar` because
// they are one form over org settings with no master list beside them; this is
// a record editor, so it follows the record editor.
//
// ⚠️ Nothing is disabled while a write is in flight. A `disabled` driven by
// `pending` fires 500ms after the last keystroke and takes the focus out of the
// field the person is still typing into. `Saving…` says the same thing without
// touching the inputs.

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
import { useRef, useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { ConnectorRunsPanel } from '~/components/data-connectors/ui/connector-runs-panel'
import { asConnectorStatus } from '~/components/data-connectors/ui/connector-status'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
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
const IMPORT_PATH = '/app/accounting/banking/import'

/**
 * The importer, with this account already selected.
 *
 * ⚠️ The param name is `account`, and it is `BankImportPage`'s own
 * `useQueryState('account')`. A different spelling lands on the importer with no
 * account chosen and no sign that anything was meant to be.
 */
function importHref(bankAccountId: string): string {
  return `${IMPORT_PATH}?account=${encodeURIComponent(bankAccountId)}`
}

/** How long a text row waits after the last keystroke before it writes. */
const TEXT_COMMIT_DELAY_MS = 500

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
   * True while an `update` is in flight.
   *
   * 🛑 Separate from {@link disconnecting}. One flag over both put the pane into
   * its saving state while a disconnect ran, which reads as "your edit is being
   * saved" over a write that is not happening.
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

export function BankAccountEditor({ account, ...rest }: BankAccountEditorProps) {
  if (!account) {
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        Select an account to map it to your chart, or connect a bank to add one.
      </div>
    )
  }

  // Keyed on the account: the text rows hold local state so an in-flight write
  // cannot flicker a half-typed field back to its stored value, and selecting a
  // different account has to reseed that state rather than carry it across.
  return <BankAccountForm key={account.id} account={account} {...rest} />
}

/** The four text rows, as this pane holds them between keystroke and write. */
interface TextValues {
  name: string
  institution: string
  last4: string
  currency: string
}

function BankAccountForm({
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
}: BankAccountEditorProps & { account: BankAccountRow }) {
  const [values, setValues] = useState<TextValues>({
    name: account.name ?? '',
    institution: account.institution ?? '',
    last4: account.last4 ?? '',
    currency: account.currency ?? '',
  })

  // The debounced writer reads the merged values through a ref: two rows edited
  // inside one delay window must not each send the state they captured on their
  // own render and undo the other.
  const valuesRef = useRef(values)

  const bufferText = (key: keyof TextValues, value: string) => {
    const merged = { ...valuesRef.current, [key]: value }
    valuesRef.current = merged
    setValues(merged)
  }

  const commitName = useDebouncedCallback(
    (value: string) => onPatch({ name: value }),
    TEXT_COMMIT_DELAY_MS
  )
  const commitInstitution = useDebouncedCallback(
    (value: string) => onPatch({ institution: value || null }),
    TEXT_COMMIT_DELAY_MS
  )
  const commitLast4 = useDebouncedCallback(
    (value: string) => onPatch({ last4: value || null }),
    TEXT_COMMIT_DELAY_MS
  )
  const commitCurrency = useDebouncedCallback(
    (value: string) => onPatch({ currency: value || null }),
    TEXT_COMMIT_DELAY_MS
  )

  // 🛑 Connector-owned identity: the feed rewrites these on every sync, so an
  // edit here would silently revert. `updateBankAccount` refuses them server
  // side; disabling the inputs is what stops somebody typing into a field that
  // is about to reject them.
  const isConnected = account.connectorId != null
  const glFilterTypes = [BANK_ACCOUNT_GL_TYPES[account.type]]

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
            value={values.institution}
            disabled={isConnected}
            placeholder='Bank of America'
            onChange={(value) => {
              const next = (value as string) ?? ''
              bufferText('institution', next)
              commitInstitution(next)
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={values.name}
            disabled={isConnected}
            placeholder='Business Adv Relationship'
            onChange={(value) => {
              const next = (value as string) ?? ''
              bufferText('name', next)
              // An empty name is refused server side, and clearing the field to
              // retype it is the ordinary way to rename an account - so the
              // write waits for something to write rather than earning a
              // refusal for a keystroke that was on its way somewhere.
              if (next.trim()) commitName(next)
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Last four'
          type={BaseType.STRING}
          showIcon
          description='Digits only. A leading zero is part of the number, so it is stored as text.'>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={values.last4}
            disabled={isConnected}
            placeholder='5381'
            onChange={(value) => {
              const next = (value as string) ?? ''
              bufferText('last4', next)
              commitLast4(next)
            }}
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
            value={account.type}
            disabled={isConnected}
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
            value={values.currency}
            disabled={isConnected}
            placeholder='USD'
            onChange={(value) => {
              const next = (value as string) ?? ''
              bufferText('currency', next)
              commitCurrency(next)
            }}
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
            onChange={(value) => {
              const iso = value as string | null
              onPatch({ feedStartDate: iso ? iso.slice(0, 10) : null })
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Coverage' type={BaseType.DATE} showIcon>
          <CoverageRow bankAccountId={account.id} coverage={coverage} isLoading={coverageLoading} />
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

      {/* The whole feedback surface for a write. A refusal arrives as the page's
          toast, verbatim, which is where it already arrived for the two rows
          that always committed on change. */}
      <div className='min-h-4 text-muted-foreground text-xs'>{pending ? 'Saving…' : null}</div>

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
  bankAccountId,
  coverage,
  isLoading,
}: {
  bankAccountId: string
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
              <Link className='text-xs underline' href={importHref(bankAccountId)}>
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
