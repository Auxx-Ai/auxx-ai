// apps/web/src/components/accounting/ui/settings/payment-gateway-editor.tsx
'use client'

// The right pane of Accounting > Settings > Payment gateways (task 13 §5.3,
// rebuilt for task 58/59: a gateway no longer carries its own clearing/fee
// account fields - those are `GlRoleAssignment` rows scoped to this rail,
// read and written exactly like the Mapping tab's own rows (D1). Three
// sections: the record's own fields, Accounts (the shared `MappingScopeRow`,
// transposed), Feeds (which `FinancialSourceAccount`s read this rail).
//
// 🛑 The top FieldPanel still commits on change, no Save button - `name`,
// `handles`, `feeTreatment` and `lastSettlementAt` are `payment_gateway`
// attributes, unrelated to the Accounts section below it.
//
// 🛑 Accounts saves on change too, immediately (MK, scope change during 59's
// build - no staged batch, no `FormSaveBar`, here or on the Mapping tab). One
// `ledger.saveMapping` call per pick, one row. A refusal drops the optimistic
// guess so the control snaps back to what is actually stored, with
// `toastError` naming why; a success invalidates `ledger.roleMap` (shared
// with the Mapping tab) plus `paymentGateway.readiness`/`list`, so both
// screens and this rail's own readiness line agree.
//
// 🛑 Handles is a TAG input, not a text field (§5.1's census: two rails arrive
// under two spellings each, and a single-string field re-creates the exact
// problem this record exists to solve). Rendered through `FieldInputAdapter`
// with `FieldType.TAGS`, the same idiom `order_payment_gateways` uses.

import { FieldType } from '@auxx/database/enums'
import type { PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
import {
  PAYMENT_GATEWAY_FEE_TREATMENT_LABELS,
  PAYMENT_GATEWAY_FEE_TREATMENTS,
} from '@auxx/lib/payment-gateways/client'
import type { GlAccountSubtypeValue, GlAccountTypeValue } from '@auxx/lib/postings/client'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { ArrowUpRight, CreditCard, Plus, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { sourceAccountLabel } from '../source-account-label'
import type { MappingAccountValue } from './mapping-account-select'
import { MappingScopeRow } from './mapping-scope-row'

// 🛑 Not a label. `billed` removes the fee leg from this rail's payout entry
// entirely (brief 26 §4), and `gross === net` becomes the expected arithmetic
// there rather than a mis-read payout.
const FEE_TREATMENT_OPTIONS = PAYMENT_GATEWAY_FEE_TREATMENTS.map((value) => ({
  value,
  label: PAYMENT_GATEWAY_FEE_TREATMENT_LABELS[value],
  color: value === 'billed' ? ('amber' as const) : ('green' as const),
}))

/** How long a text row waits after the last keystroke before it writes. */
const TEXT_COMMIT_DELAY_MS = 500

export interface PaymentGatewayPatch {
  name?: string
  handles?: string[]
  feeTreatment?: PaymentGatewayRow['feeTreatment']
  lastSettlementAt?: string | null
}

/** The three rail roles, in the order §3's Accounts section renders them. */
const RAIL_ROLES = [
  {
    role: 'clearing',
    label: 'Clearing',
    filterType: 'asset' as GlAccountTypeValue,
    subtypePin: 'clearing' as GlAccountSubtypeValue,
  },
  {
    role: 'payment_processing_fees',
    label: 'Fees',
    filterType: 'expense' as GlAccountTypeValue,
    subtypePin: undefined,
  },
  {
    role: 'bank',
    label: 'Bank',
    filterType: 'asset' as GlAccountTypeValue,
    subtypePin: 'bank' as GlAccountSubtypeValue,
  },
] as const

/**
 * Cancels the scroll container's `p-3` so a `Section` sits FLUSH with the
 * panel. See `bank-account-editor.tsx`'s `SECTION_BLEED` for the full reason.
 */
const SECTION_BLEED = '-mx-3'

interface PaymentGatewayEditorProps {
  gateway: PaymentGatewayRow | null
  /** True while an `update` is in flight. */
  pending: boolean
  /** True while the close is in flight. */
  closing?: boolean
  onPatch: (patch: PaymentGatewayPatch) => void
  /** Mark the gateway closed. Disabled while it already is. */
  onClose: () => void
  /** `PermissionKey.ledgerControl` - false disables every picker in Accounts and hides Link/Unlink. */
  canControl: boolean
}

export function PaymentGatewayEditor({ gateway, ...rest }: PaymentGatewayEditorProps) {
  if (!gateway) {
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        Select a gateway to map it to your chart, or add one.
      </div>
    )
  }
  // Keyed on the gateway: the name row holds local state so an in-flight
  // write cannot flicker a half-typed field back to its stored value, and
  // selecting a different gateway has to reseed that state rather than carry
  // it across.
  return <PaymentGatewayForm key={gateway.id} gateway={gateway} {...rest} />
}

function PaymentGatewayForm({
  gateway,
  pending,
  closing = false,
  onPatch,
  onClose,
  canControl,
}: PaymentGatewayEditorProps & { gateway: PaymentGatewayRow }) {
  const [name, setName] = useState(gateway.name)
  const nameRef = useRef(name)

  const commitName = useDebouncedCallback((value: string) => {
    if (value.trim()) onPatch({ name: value })
  }, TEXT_COMMIT_DELAY_MS)

  // 🛑 The option set is DERIVED from the values. `payment_gateway_handles` is an
  // OPEN, value-keyed TAGS field - the registry declares `options: { options: [] }`
  // and the write stores the raw string - so a stored handle matches no option row.
  // Handing the picker a literal `[]` made every handle resolve `unknown`: the
  // trigger rendered it italic-grey as "not in this field's option set", and it
  // never appeared in the popover at all, so it could not be unchecked. Nothing is
  // wrong with what is stored; the input has to be told the values ARE the options.
  const handleOptions = useMemo(
    () => gateway.handles.map((handle) => ({ label: handle, value: handle })),
    [gateway.handles]
  )

  const isClosed = gateway.status === 'closed'

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3'>
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='flex items-center gap-2 truncate font-medium text-sm'>
          <CreditCard className='size-4 text-muted-foreground' />
          {gateway.name || 'Untitled gateway'}
        </span>
        <span className='text-muted-foreground text-xs'>
          {isClosed
            ? 'Closed. Its history still routes to this clearing account, but a merchant would add a new gateway for a new rail.'
            : 'The rail that took the money for an order. Its clearing, fee and bank accounts map below.'}
        </span>
      </div>

      <FieldPanel
        className='shrink-0 grow-0 p-0'
        resizeId='accounting-payment-gateway'
        defaultLabelWidth={150}>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            placeholder='Authorize.Net'
            onChange={(value) => {
              const next = (value as string) ?? ''
              nameRef.current = next
              setName(next)
              commitName(next)
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Gateway handles'
          type={BaseType.STRING}
          showIcon
          isRequired
          description='Every stored value this rail is seen under. Two spellings of the same rail (authorize_net / authorize.net) both belong here.'>
          <FieldInputAdapter
            fieldType={FieldType.TAGS}
            fieldOptions={{ options: handleOptions }}
            useValueAsLabel
            value={gateway.handles}
            triggerProps={{ className: 'w-full ps-0 pe-1', showClear: false }}
            placeholder='Add a handle'
            onChange={(value) => {
              const handles = Array.isArray(value) ? (value as string[]) : []
              if (handles.length > 0) onPatch({ handles })
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Fee treatment'
          type={BaseType.ENUM}
          showIcon
          description='Netted means the processor withholds its cut from the deposit, so the fee is booked inside every payout entry. Billed means the deposit is gross and the fees arrive later on a statement - that rail’s payout carries no fee leg at all.'>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: FEE_TREATMENT_OPTIONS }}
            value={gateway.feeTreatment}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            placeholder='Select fee treatment'
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              if (next === 'netted' || next === 'billed') onPatch({ feeTreatment: next })
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Status' type={BaseType.ENUM} showIcon>
          <div className='flex min-h-8 items-center'>
            <Badge variant={isClosed ? 'secondary' : 'outline'} size='sm'>
              {isClosed ? 'Closed' : 'Active'}
            </Badge>
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Last settlement'
          type={BaseType.DATE}
          showIcon
          description='Informational only - nothing in posting reads this.'>
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            value={gateway.lastSettlementAt ? `${gateway.lastSettlementAt}T00:00:00.000Z` : null}
            onChange={(value) => {
              const iso = value as string | null
              onPatch({ lastSettlementAt: iso ? iso.slice(0, 10) : null })
            }}
          />
        </FieldPanelRow>
      </FieldPanel>

      <AccountsSection gatewayId={gateway.id} canControl={canControl} />
      <FeedsSection gatewayId={gateway.id} canControl={canControl} />

      <div className='min-h-4 text-muted-foreground text-xs'>{pending ? 'Saving…' : null}</div>

      {!isClosed && (
        <Section title='Danger zone' initialOpen={false} className={SECTION_BLEED}>
          <div className='flex flex-col gap-2 p-1'>
            <p className='text-muted-foreground text-xs'>
              Closing keeps every shipment that ever routed here posting to this same clearing
              account, so its balance still winds down correctly. It just stops offering this
              gateway as the answer for a new order.
            </p>
            <div>
              <Button variant='destructive' size='sm' loading={closing} onClick={onClose}>
                Close gateway
              </Button>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts - the Mapping tab's own rows, transposed onto one rail (59 §3, D1)
// ─────────────────────────────────────────────────────────────────────────────

function AccountsSection({ gatewayId, canControl }: { gatewayId: string; canControl: boolean }) {
  const roleMap = api.ledger.roleMap.useQuery()
  // Only for the Bank row's mismatch line (58 §5.4 rule 2) - the Feeds section
  // below reads the same query for its own list.
  const readiness = api.paymentGateway.readiness.useQuery({ gatewayId })
  const bankMismatch = readiness.data?.mismatches[0]?.message
  const utils = api.useUtils()
  const [optimistic, setOptimistic] = useState<Record<string, MappingAccountValue>>({})
  const [currencyDrafts, setCurrencyDrafts] = useState<Record<string, string[]>>({})

  const saveMapping = api.ledger.saveMapping.useMutation({
    onSuccess: async (_data, variables) => {
      await Promise.all([
        utils.ledger.roleMap.invalidate(),
        utils.paymentGateway.readiness.invalidate({ gatewayId }),
        utils.paymentGateway.list.invalidate(),
      ])
      setOptimistic((prev) => {
        const next = { ...prev }
        for (const row of variables) delete next[row.role + (row.currency ?? '')]
        return next
      })
    },
    onError: (error, variables) => {
      setOptimistic((prev) => {
        const next = { ...prev }
        for (const row of variables) delete next[row.role + (row.currency ?? '')]
        return next
      })
      toastError({ title: 'Error saving the mapping', description: error.message })
    },
  })

  const commit = (role: string, currency: string | null, value: string | 'inherit') => {
    setOptimistic((prev) => ({ ...prev, [role + (currency ?? '')]: value }))
    saveMapping.mutate([{ role, scope: { rail: gatewayId }, currency, value }])
  }

  if (roleMap.isPending) {
    return (
      <Section title='Accounts' className={SECTION_BLEED}>
        <EmptySection loading />
      </Section>
    )
  }

  return (
    <Section
      title='Accounts'
      className={SECTION_BLEED}
      actions={
        <Link
          href={`/app/accounting/settings/accounts?s=mapping&scope=${encodeURIComponent(gatewayId)}`}
          className='flex items-center gap-1 text-primary-600 text-xs hover:underline'>
          Map on the Mapping tab
          <ArrowUpRight className='size-3' />
        </Link>
      }>
      <div className='flex flex-col gap-0.5'>
        {RAIL_ROLES.map(({ role, label, filterType, subtypePin }) => {
          const row = roleMap.data?.roles.find((r) => r.role === role)
          const isBank = role === 'bank'
          const own = row?.railOverrides.find(
            (o) => o.paymentGatewayId === gatewayId && o.currency === null
          )
          const persisted: MappingAccountValue = own ? own.accountId : isBank ? null : 'inherit'
          const key = role
          const value = key in optimistic ? optimistic[key]! : persisted
          const inheritedName = isBank ? null : row?.account ? accountText(row.account) : null

          const currencyRows =
            row?.railOverrides.filter(
              (o) => o.paymentGatewayId === gatewayId && o.currency !== null
            ) ?? []
          const existingCurrencies = new Set(currencyRows.map((o) => o.currency as string))
          const optimisticCurrencies = Object.keys(optimistic)
            .filter(
              (k) =>
                k.startsWith(role) &&
                k.length === role.length + 3 &&
                !existingCurrencies.has(k.slice(role.length))
            )
            .map((k) => k.slice(role.length))

          return (
            <MappingScopeRow
              key={role}
              depth={1}
              title={label}
              value={value}
              onChange={(next) => commit(role, null, next)}
              inheritedAccountName={inheritedName}
              filterTypes={[filterType]}
              subtypePin={subtypePin}
              suggested={!(key in optimistic) && own?.state === 'suggested'}
              onConfirmSuggested={
                own
                  ? () =>
                      saveMapping.mutate([
                        { role, scope: { rail: gatewayId }, value: own.accountId },
                      ])
                  : undefined
              }
              onAddCurrency={
                canControl
                  ? () =>
                      setCurrencyDrafts((prev) => ({
                        ...prev,
                        [role]: [...(prev[role] ?? []), ''],
                      }))
                  : undefined
              }
              mismatchMessage={isBank ? bankMismatch : undefined}
              disabled={!canControl}>
              {currencyRows.map((o) => (
                <RailRoleCurrencyRow
                  key={o.currency}
                  role={role}
                  currency={o.currency as string}
                  override={o}
                  railOwnLabel={own?.account ? accountText(own.account) : null}
                  isBank={isBank}
                  orgDefaultLabel={inheritedName}
                  optimistic={optimistic}
                  filterType={filterType}
                  subtypePin={subtypePin}
                  onCommit={commit}
                  onConfirm={(accountId) =>
                    saveMapping.mutate([
                      { role, scope: { rail: gatewayId }, currency: o.currency, value: accountId },
                    ])
                  }
                  canControl={canControl}
                />
              ))}
              {optimisticCurrencies.map((currency) => (
                <RailRoleCurrencyRow
                  key={currency}
                  role={role}
                  currency={currency}
                  override={undefined}
                  railOwnLabel={own?.account ? accountText(own.account) : null}
                  isBank={isBank}
                  orgDefaultLabel={inheritedName}
                  optimistic={optimistic}
                  filterType={filterType}
                  subtypePin={subtypePin}
                  onCommit={commit}
                  onConfirm={() => {}}
                  canControl={canControl}
                />
              ))}
              {(currencyDrafts[role] ?? []).map((code, index) => (
                <CurrencyDraft
                  key={index}
                  code={code}
                  existing={new Set([...existingCurrencies, ...optimisticCurrencies])}
                  filterType={filterType}
                  subtypePin={subtypePin}
                  onChange={(next) =>
                    setCurrencyDrafts((prev) => {
                      const list = [...(prev[role] ?? [])]
                      list[index] = next
                      return { ...prev, [role]: list }
                    })
                  }
                  onPick={(accountId) => {
                    commit(role, code, accountId)
                    setCurrencyDrafts((prev) => ({
                      ...prev,
                      [role]: (prev[role] ?? []).filter((_, i) => i !== index),
                    }))
                  }}
                  onRemove={() =>
                    setCurrencyDrafts((prev) => ({
                      ...prev,
                      [role]: (prev[role] ?? []).filter((_, i) => i !== index),
                    }))
                  }
                />
              ))}
            </MappingScopeRow>
          )
        })}
      </div>
    </Section>
  )
}

function accountText(account: { code: string | null; name: string }): string {
  return account.code ? `${account.code} · ${account.name}` : account.name
}

function RailRoleCurrencyRow({
  role,
  currency,
  override,
  railOwnLabel,
  isBank,
  orgDefaultLabel,
  optimistic,
  filterType,
  subtypePin,
  onCommit,
  onConfirm,
  canControl,
}: {
  role: string
  currency: string
  override: { accountId: string; state: 'confirmed' | 'suggested' } | undefined
  railOwnLabel: string | null
  isBank: boolean
  orgDefaultLabel: string | null
  optimistic: Record<string, MappingAccountValue>
  filterType: GlAccountTypeValue
  subtypePin: GlAccountSubtypeValue | undefined
  onCommit: (role: string, currency: string | null, value: string | 'inherit') => void
  onConfirm: (accountId: string) => void
  canControl: boolean
}) {
  const persisted: MappingAccountValue = override ? override.accountId : 'inherit'
  const key = role + currency
  const value = key in optimistic ? optimistic[key]! : persisted
  const inheritedName = railOwnLabel ?? (isBank ? null : orgDefaultLabel)

  return (
    <MappingScopeRow
      depth={2}
      title={currency}
      value={value}
      onChange={(next) => onCommit(role, currency, next)}
      inheritedAccountName={inheritedName}
      filterTypes={[filterType]}
      subtypePin={subtypePin}
      suggested={!(key in optimistic) && override?.state === 'suggested'}
      onConfirmSuggested={override ? () => onConfirm(override.accountId) : undefined}
      disabled={!canControl}
    />
  )
}

function CurrencyDraft({
  code,
  existing,
  filterType,
  subtypePin,
  onChange,
  onPick,
  onRemove,
}: {
  code: string
  existing: Set<string>
  filterType: GlAccountTypeValue
  subtypePin: GlAccountSubtypeValue | undefined
  onChange: (code: string) => void
  onPick: (accountId: string) => void
  onRemove: () => void
}) {
  const valid = /^[A-Z]{3}$/.test(code) && !existing.has(code)
  return (
    <MappingScopeRow
      depth={2}
      title={
        <AutosizeInput
          value={code}
          onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 3))}
          placeholder='USD'
          minWidth={40}
          inputClassName='bg-transparent text-sm text-foreground outline-none uppercase'
        />
      }
      value={null}
      onChange={(next) => next !== 'inherit' && valid && onPick(next)}
      filterTypes={[filterType]}
      subtypePin={subtypePin}
      extraActions={
        <TreeRowButton tooltipText='Remove' onClick={onRemove}>
          <X />
        </TreeRowButton>
      }
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Feeds - the `FinancialSourceAccount`s reading this rail (59 §3)
// ─────────────────────────────────────────────────────────────────────────────

function FeedsSection({ gatewayId, canControl }: { gatewayId: string; canControl: boolean }) {
  const utils = api.useUtils()
  const readiness = api.paymentGateway.readiness.useQuery({ gatewayId })
  const [linking, setLinking] = useState(false)
  const [pickedFeed, setPickedFeed] = useState<string | null>(null)
  const unlinked = api.paymentGateway.listUnlinkedFeeds.useQuery(undefined, { enabled: linking })
  const [confirm, ConfirmDialog] = useConfirm()

  const invalidate = () =>
    Promise.all([
      utils.paymentGateway.readiness.invalidate({ gatewayId }),
      utils.paymentGateway.listUnlinkedFeeds.invalidate(),
    ])

  const linkFeed = api.paymentGateway.linkFeed.useMutation({
    onSuccess: async () => {
      setLinking(false)
      setPickedFeed(null)
      await invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error linking the feed', description: error.message })
    },
  })

  const unlinkFeed = api.paymentGateway.unlinkFeed.useMutation({
    onSuccess: () => invalidate(),
    onError: (error) => {
      toastError({ title: 'Error unlinking the feed', description: error.message })
    },
  })

  async function handleUnlink(sourceAccountId: string, name: string) {
    const confirmed = await confirm({
      title: `Unlink ${name}?`,
      description:
        'The feed and its history are untouched - only which rail reads it for new payouts changes.',
      confirmText: 'Unlink',
      cancelText: 'Cancel',
    })
    if (confirmed) unlinkFeed.mutate({ sourceAccountId })
  }

  const readinessLine = readiness.data
    ? readiness.data.ready
      ? 'Ready to post.'
      : !readiness.data.clearingMapped
        ? 'Needs a clearing account - map it above.'
        : 'Needs a receiving bank account - the Bank row above is highlighted.'
    : null

  return (
    <>
      <Section title='Feeds' className={SECTION_BLEED}>
        <div className='flex flex-col gap-2 p-1'>
          {readiness.isPending ? (
            <EmptySection loading />
          ) : readiness.data?.linkedFeeds.length === 0 ? (
            <p className='text-muted-foreground text-xs'>
              No feed linked. Shipments still route here by handle; a payout for this rail cannot
              post until a feed is linked and mapped to a bank account.
            </p>
          ) : (
            readiness.data?.linkedFeeds.map((feed) => (
              <div key={feed.sourceAccountId} className='flex items-center gap-2 text-sm'>
                <span className='min-w-0 flex-1 truncate'>{sourceAccountLabel(feed)}</span>
                {canControl && (
                  <Button
                    variant='ghost'
                    size='xs'
                    onClick={() =>
                      void handleUnlink(feed.sourceAccountId, sourceAccountLabel(feed))
                    }>
                    Unlink
                  </Button>
                )}
              </div>
            ))
          )}

          {readiness.data && readiness.data.mismatches.length > 0 && (
            <div className='flex flex-col gap-1'>
              {readiness.data.mismatches.map((m) => (
                <span
                  key={m.payoutId}
                  className='flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-400'>
                  <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
                  {m.message}
                </span>
              ))}
            </div>
          )}

          {canControl && !linking && (
            <Button
              variant='outline'
              size='sm'
              className='self-start'
              onClick={() => setLinking(true)}>
              <Plus />
              Link a feed
            </Button>
          )}

          {linking && (
            <div className='flex items-center gap-2'>
              <Select value={pickedFeed ?? undefined} onValueChange={setPickedFeed}>
                <SelectTrigger size='sm' className='w-full'>
                  <SelectValue placeholder={unlinked.isPending ? 'Loading…' : 'Select a feed…'} />
                </SelectTrigger>
                <SelectContent>
                  {(unlinked.data ?? []).length === 0 && !unlinked.isPending ? (
                    <div className='p-2 text-muted-foreground text-xs'>
                      No live feed is reporting activity with nothing claiming it yet.
                    </div>
                  ) : (
                    (unlinked.data ?? []).map((feed) => (
                      <SelectItem key={feed.processorAccountId} value={feed.processorAccountId}>
                        {sourceAccountLabel({
                          providerKey: feed.providerKey,
                          externalAccountId: feed.externalAccountId,
                          name: feed.name,
                        })}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                variant='outline'
                size='sm'
                loading={linkFeed.isPending}
                disabled={!pickedFeed}
                onClick={() =>
                  pickedFeed && linkFeed.mutate({ gatewayId, sourceAccountId: pickedFeed })
                }>
                Link
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  setLinking(false)
                  setPickedFeed(null)
                }}>
                Cancel
              </Button>
            </div>
          )}

          {readinessLine && (
            <p
              className={
                readiness.data?.ready
                  ? 'text-muted-foreground text-xs'
                  : 'text-amber-700 text-xs dark:text-amber-400'
              }>
              {readinessLine}
            </p>
          )}
        </div>
      </Section>
      <ConfirmDialog />
    </>
  )
}
