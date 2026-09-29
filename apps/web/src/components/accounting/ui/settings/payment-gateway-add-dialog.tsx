// apps/web/src/components/accounting/ui/settings/payment-gateway-add-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { processorByHandle } from '@auxx/lib/accounting/processors/client'
import {
  normaliseGatewayHandle,
  PAYMENT_GATEWAY_FEE_TREATMENT_LABELS,
  PAYMENT_GATEWAY_FEE_TREATMENTS,
  type PaymentGatewayFeeTreatmentValue,
  type PaymentGatewayRow,
  type RailFeedStatus,
} from '@auxx/lib/accounting/rails/client'
import { suggestRail } from '@auxx/lib/accounting/rails/rail-catalogue'
import {
  defaultMintFeeAccount,
  findReusableRailAccount,
} from '@auxx/lib/accounting/rails/rail-groups'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { PlugZap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { type MappingAccountValue, MINT_ACCOUNT_VALUE } from './mapping-account-select'
import {
  accountText,
  RailAccountRows,
  type RailRole,
  railReadinessLine,
  useFeedOptions,
  useHandleOptions,
} from './payment-gateway-rail-rows'
import { RailFeedNote, railFeedCopy } from './rail-feed-note'

const FEE_TREATMENT_OPTIONS = PAYMENT_GATEWAY_FEE_TREATMENTS.map((value) => ({
  value,
  label: PAYMENT_GATEWAY_FEE_TREATMENT_LABELS[value],
  color: value === 'billed' ? ('amber' as const) : ('green' as const),
}))

/** The dialog's fields, as it holds them before the write. */
export interface AddDraft {
  name: string
  handles: string[]
  feeTreatment: PaymentGatewayFeeTreatmentValue
  accounts: Record<RailRole, MappingAccountValue>
  feedId: string | null
  /** A person typed or picked it, so a new first handle stops re-suggesting it. */
  touched: { name: boolean; feeTreatment: boolean; fee: boolean; feed: boolean }
}

/** A fresh draft, seeded from the catalogue's guess for the first handle. */
export function draftFor(initial?: string | readonly string[]): AddDraft {
  const handles = (typeof initial === 'string' ? [initial] : (initial ?? []))
    .map((handle) => handle.trim())
    .filter(Boolean)
  const suggestion = suggestRail(handles[0] ?? '')
  return {
    name: handles.length > 0 ? suggestion.name : '',
    handles,
    feeTreatment: suggestion.feeTreatment,
    accounts: {
      clearing: MINT_ACCOUNT_VALUE,
      payment_processing_fees: feeDefault(suggestion.feeTreatment),
      bank: null,
    },
    feedId: null,
    touched: { name: false, feeTreatment: false, fee: false, feed: false },
  }
}

/** A billed rail gets its own fee account by default, the wizard's rule. */
function feeDefault(feeTreatment: PaymentGatewayFeeTreatmentValue): MappingAccountValue {
  return defaultMintFeeAccount(feeTreatment) ? MINT_ACCOUNT_VALUE : 'inherit'
}

/** The gateway that already routes another catalogue spelling of `handle`, e.g. `authorize_net` for `authorize.net`. */
export function findSiblingGateway(
  handle: string,
  gateways: readonly PaymentGatewayRow[]
): PaymentGatewayRow | null {
  const suggestion = suggestRail(handle)
  if (!suggestion.known) return null
  const key = normaliseGatewayHandle(handle)
  return (
    gateways.find(
      (gateway) =>
        gateway.status !== 'closed' &&
        !gateway.handles.some((h) => normaliseGatewayHandle(h) === key) &&
        gateway.handles.some((h) => {
          const other = suggestRail(h)
          return other.known && other.name === suggestion.name
        })
    ) ?? null
  )
}

/**
 * The feed state the dialog shows for its handles. `linked_elsewhere` is dropped while the sibling
 * suggestion is up, because that alert already offers to add the handle to the other gateway.
 */
export function addDialogFeed(
  feed: RailFeedStatus | null | undefined,
  siblingShown: boolean
): RailFeedStatus | null {
  if (!feed) return null
  if (feed.state === 'linked_elsewhere' && siblingShown) return null
  return railFeedCopy(feed, true) ? feed : null
}

export interface PaymentGatewayAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The gateway written or extended; `paymentGateway.list` is already invalidated. */
  onCreated?: (gateway: PaymentGatewayRow) => void
  /** A handle as seen on the order, e.g. from a Blocked row; seeds handles, name and treatment. */
  initialHandle?: string
  /** Every spelling of one rail, e.g. a wizard rail group. Takes precedence over `initialHandle`. */
  initialHandles?: readonly string[]
  /** Written with the gateway; the wizard closes a rail that has gone quiet. */
  status?: 'active' | 'closed'
}

/** Sets a rail up with the same rows the gateway editor shows: accounts, bank and feed included. */
export function PaymentGatewayAddDialog({
  open,
  onOpenChange,
  onCreated,
  initialHandle,
  initialHandles,
  status,
}: PaymentGatewayAddDialogProps) {
  const utils = api.useUtils()
  // A string key, so a caller's inline array does not reseed the draft on every render.
  const initialKey = (initialHandles ?? (initialHandle ? [initialHandle] : [])).join('\n')
  const [draft, setDraft] = useState<AddDraft>(() => draftFor(initialKey.split('\n')))

  // Reseed on every open, so a Blocked row's handle is not left over from the last one.
  useEffect(() => {
    if (open) setDraft(draftFor(initialKey.split('\n')))
  }, [open, initialKey])

  const invalidate = () =>
    Promise.all([
      utils.paymentGateway.list.invalidate(),
      utils.paymentGateway.observedHandles.invalidate(),
      utils.paymentGateway.listUnlinkedFeeds.invalidate(),
      utils.paymentGateway.readiness.invalidate(),
      utils.paymentGateway.feedStateForHandles.invalidate(),
      utils.ledger.roleMap.invalidate(),
      utils.ledger.chartAccounts.invalidate(),
    ])

  const setUp = api.paymentGateway.setUp.useMutation({
    onSuccess: async ({ gateway, failures }) => {
      await invalidate()
      onOpenChange(false)
      onCreated?.(gateway)
      if (failures.length > 0) {
        toastError({
          title: `${gateway.name} was added, but its ${failures.map((f) => f.step).join(' and ')} did not save`,
          description: failures.map((f) => f.message).join(' '),
        })
      }
    },
    onError: (error) =>
      toastError({ title: 'Error adding the gateway', description: error.message }),
  })

  const extend = api.paymentGateway.update.useMutation({
    onSuccess: async (gateway) => {
      await invalidate()
      onOpenChange(false)
      onCreated?.(gateway)
    },
    onError: (error) =>
      toastError({ title: 'Error adding the handle', description: error.message }),
  })
  const pending = setUp.isPending || extend.isPending

  const gateways = api.paymentGateway.list.useQuery(undefined, { enabled: open })
  const chart = api.ledger.chartAccounts.useQuery(undefined, { enabled: open })
  const roleMap = api.ledger.roleMap.useQuery(undefined, { enabled: open })
  const handleOptions = useHandleOptions(draft.handles, open)
  const feeds = useFeedOptions(open)

  const firstHandle = draft.handles[0] ?? ''
  const sibling = useMemo(
    () => (firstHandle ? findSiblingGateway(firstHandle, gateways.data ?? []) : null),
    [firstHandle, gateways.data]
  )

  const hasProcessor = draft.handles.some((handle) => processorByHandle(handle) !== null)
  const feedState = api.paymentGateway.feedStateForHandles.useQuery(
    { groups: [draft.handles] },
    { enabled: open && hasProcessor }
  )
  const feed = addDialogFeed(hasProcessor ? feedState.data?.[0] : null, !!sibling)
  const candidateFeedId = feed?.candidateSourceAccountId ?? null

  // `available` cannot Link a gateway that does not exist yet, so it preselects the feed instead.
  useEffect(() => {
    if (!open || !candidateFeedId) return
    setDraft((prev) =>
      prev.feedId === null && !prev.touched.feed ? { ...prev, feedId: candidateFeedId } : prev
    )
  }, [open, candidateFeedId])

  // An account already named for this rail is preselected over minting a second copy of it.
  const railName = draft.name.trim()
  const reusable = useMemo(() => {
    if (!chart.data || !gateways.data || !railName) return null
    const held = new Set(gateways.data.map((row) => row.clearingGlAccountId))
    return {
      clearing: findReusableRailAccount(chart.data, `${railName} Clearing`, 'clearing', held),
      fee: findReusableRailAccount(chart.data, `${railName} Fees`, 'fee'),
    }
  }, [chart.data, gateways.data, railName])
  useEffect(() => {
    if (!open || !reusable) return
    setDraft((prev) => {
      const clearing =
        prev.accounts.clearing === MINT_ACCOUNT_VALUE && reusable.clearing
          ? reusable.clearing
          : prev.accounts.clearing
      const fee =
        prev.accounts.payment_processing_fees === MINT_ACCOUNT_VALUE && reusable.fee
          ? reusable.fee
          : prev.accounts.payment_processing_fees
      if (clearing === prev.accounts.clearing && fee === prev.accounts.payment_processing_fees)
        return prev
      return { ...prev, accounts: { ...prev.accounts, clearing, payment_processing_fees: fee } }
    })
  }, [open, reusable])

  const feeAccount = roleMap.data?.roles.find((r) => r.role === 'payment_processing_fees')?.account
  const name = draft.name.trim()
  const readiness = railReadinessLine({
    clearingMapped: draft.accounts.clearing !== null,
    bankMapped: !!draft.accounts.bank && draft.accounts.bank !== MINT_ACCOUNT_VALUE,
    feedLinked: draft.feedId !== null,
    feed,
  })

  function setHandles(handles: string[]) {
    setDraft((prev) => {
      const suggestion = suggestRail(handles[0] ?? '')
      const feeTreatment = prev.touched.feeTreatment ? prev.feeTreatment : suggestion.feeTreatment
      return {
        ...prev,
        handles,
        name: prev.touched.name ? prev.name : handles.length > 0 ? suggestion.name : '',
        feeTreatment,
        accounts: {
          ...prev.accounts,
          payment_processing_fees: prev.touched.fee
            ? prev.accounts.payment_processing_fees
            : feeDefault(feeTreatment),
        },
      }
    })
  }

  function setFeeTreatment(feeTreatment: PaymentGatewayFeeTreatmentValue) {
    setDraft((prev) => ({
      ...prev,
      feeTreatment,
      touched: { ...prev.touched, feeTreatment: true },
      accounts: {
        ...prev.accounts,
        payment_processing_fees: prev.touched.fee
          ? prev.accounts.payment_processing_fees
          : feeDefault(feeTreatment),
      },
    }))
  }

  function setAccount(role: RailRole, value: string | 'inherit') {
    setDraft((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, [role]: value },
      touched: role === 'payment_processing_fees' ? { ...prev.touched, fee: true } : prev.touched,
    }))
  }

  const canSubmit = !!name && draft.handles.length > 0 && draft.accounts.clearing !== null

  function choice(value: MappingAccountValue, mintName: string) {
    if (value === MINT_ACCOUNT_VALUE) return { mint: mintName }
    return value && value !== 'inherit' && value !== 'unused' ? { accountId: value } : null
  }

  function submit() {
    const clearing = choice(draft.accounts.clearing, `${name} Clearing`)
    if (!clearing) return
    setUp.mutate({
      name,
      handles: draft.handles,
      feeTreatment: draft.feeTreatment,
      status,
      clearing,
      fee: choice(draft.accounts.payment_processing_fees, `${name} Fees`),
      bankAccountId:
        draft.accounts.bank && draft.accounts.bank !== MINT_ACCOUNT_VALUE
          ? draft.accounts.bank
          : null,
      sourceAccountId: draft.feedId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Add a payment gateway</DialogTitle>
          <DialogDescription>
            The rail that takes money for an order, with the accounts it clears through and the feed
            that reports its payouts.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          {sibling && (
            <Alert>
              <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
                <span>
                  {sibling.name} already routes {sibling.handles.join(', ')}. Is {firstHandle} the
                  same rail?
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  loading={extend.isPending}
                  loadingText='Adding...'
                  disabled={pending}
                  onClick={() =>
                    extend.mutate({ id: sibling.id, handles: [...sibling.handles, firstHandle] })
                  }>
                  Add {firstHandle} to {sibling.name}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-payment-gateway-add'
            defaultLabelWidth={140}
            className='p-0'>
            <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={draft.name}
                placeholder='Authorize.Net'
                disabled={pending}
                onChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    name: (value as string) ?? '',
                    touched: { ...prev.touched, name: true },
                  }))
                }
              />
            </FieldPanelRow>
            <FieldPanelRow
              title='Gateway handles'
              type={BaseType.STRING}
              showIcon
              isRequired
              description='Every stored value this rail is seen under, exactly as it appears on the order.'>
              <FieldInputAdapter
                fieldType={FieldType.TAGS}
                fieldOptions={{ options: handleOptions }}
                useValueAsLabel
                value={draft.handles}
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
                placeholder='Add a handle'
                disabled={pending}
                onChange={(value) => setHandles(Array.isArray(value) ? (value as string[]) : [])}
              />
            </FieldPanelRow>
            <FieldPanelRow
              title='Fee treatment'
              type={BaseType.ENUM}
              showIcon
              description='Netted: the processor keeps its cut from the deposit. Billed: the deposit is gross and fees arrive on a statement.'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: FEE_TREATMENT_OPTIONS }}
                value={draft.feeTreatment}
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
                disabled={pending}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (next === 'netted' || next === 'billed') setFeeTreatment(next)
                }}
              />
            </FieldPanelRow>
            <FieldPanelRow
              title='Feed'
              icon={<PlugZap className='size-4 text-muted-foreground' />}
              showIcon
              description='The processor account that reports this rail’s payouts.'>
              {!feeds.isPending && feeds.options.length === 0 && feed ? (
                <RailFeedNote feed={feed} canControl={false} className='min-h-8 py-1' />
              ) : (
                <div className='flex min-w-0 flex-col'>
                  <FieldInputAdapter
                    fieldType={FieldType.SINGLE_SELECT}
                    fieldOptions={{ options: feeds.options }}
                    value={draft.feedId}
                    triggerProps={{ className: 'w-full ps-0 pe-1' }}
                    placeholder={
                      feeds.isPending
                        ? 'Loading…'
                        : feeds.options.length === 0
                          ? 'No unclaimed feed'
                          : 'Select a feed'
                    }
                    disabled={pending || feeds.options.length === 0}
                    onChange={(value) => {
                      const next = Array.isArray(value) ? value[0] : value
                      setDraft((prev) => ({
                        ...prev,
                        feedId: (next as string | undefined) ?? null,
                        touched: { ...prev.touched, feed: true },
                      }))
                    }}
                  />
                  {feed && <RailFeedNote feed={feed} canControl={false} className='pb-1' />}
                </div>
              )}
            </FieldPanelRow>
          </FieldPanel>

          <div className='flex flex-col gap-1'>
            <span className='font-medium text-sm'>Accounts</span>
            <RailAccountRows
              values={draft.accounts}
              onChange={setAccount}
              inheritedNames={{
                clearing: null,
                payment_processing_fees: feeAccount ? accountText(feeAccount) : null,
                bank: null,
              }}
              mintLabels={{
                clearing: `${name || 'Gateway'} Clearing`,
                payment_processing_fees: `${name || 'Gateway'} Fees`,
              }}
              disabled={pending}
            />
          </div>

          <p
            className={
              readiness.ready
                ? 'text-muted-foreground text-xs'
                : 'text-amber-700 text-xs dark:text-amber-400'
            }>
            {readiness.text}
          </p>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={pending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={setUp.isPending}
            loadingText='Adding...'
            disabled={!canSubmit || pending}
            onClick={submit}
            data-dialog-submit>
            Add gateway <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
