// apps/web/src/components/accounting/ui/setup-wizard/wizard-rails-page.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { ACCOUNT_ROLES } from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import {
  buildRailGroups,
  defaultMintFeeAccount,
  isStaleRail,
  type RailGroup,
  type RailGroupState,
  sharedClearingAccounts,
  warnsAboutFeeFallback,
} from './wizard-rails-model'

const GATEWAYS_HREF = '/app/accounting/settings/payment-gateways'

const STATE_BADGE: Record<
  RailGroupState,
  { label: string; variant: 'green' | 'amber' | 'destructive' }
> = {
  routed: { label: 'Routed', variant: 'green' },
  split: { label: 'Partly routed', variant: 'amber' },
  unrouted: { label: 'Not routed', variant: 'destructive' },
}

/** The create form's fields, while a rail's row is expanded. */
interface CreateDraft {
  key: string
  name: string
  clearingAccountName: string
  mintFeeAccount: boolean
  feeAccountName: string
  markClosed: boolean
}

/**
 * Page 6 of `AccountingSetupWizard` - the payment rails on this org's own
 * orders, and an account for each (brief 26 §8).
 *
 * 🛑 **Placement is load-bearing, and both ends of it.** It sits AFTER
 * `accounts`, because an account cannot be picked or minted before a chart
 * exists, and BEFORE `accountMap`, because the QuickBooks mapping page has to
 * see the accounts this page created.
 *
 * 🛑 **Skippable, like every other page.** `P1` makes "nothing configured" a
 * supported state; nothing here may refuse Continue. Both warnings below are
 * warnings - the fee-fallback one especially, which §13 decision 1 settles as a
 * warning precisely because the alternative is a refusal at close a month later
 * and far from its cause.
 *
 * What it adds over the settings list, which deliberately has none of it:
 *
 * 1. **Order counts and a last-seen date.** A handle with 5,000 orders and none
 *    in the last year is a retired rail that wants an account and a `closed`
 *    status; a handle with orders last week and no record is the actual alarm.
 *    Nothing else separates those two.
 * 2. **Spelling variants grouped**, with a merge - `authorize_net` and
 *    `authorize.net` are one rail, and routing them separately is how a rail's
 *    money ends up in two accounts.
 * 3. **A shared-account warning at the moment of choosing.**
 * 4. **The create button**, which is the point of the step: it mints the rail's
 *    accounts and writes the record in one call (§7.4's composed procedure).
 */
export function WizardRailsPage() {
  const census = api.paymentGateway.handleCensus.useQuery()
  const gateways = api.paymentGateway.list.useQuery({ includeArchived: true })
  const roleMap = api.ledger.roleMap.useQuery()
  const utils = api.useUtils()

  const [draft, setDraft] = useState<CreateDraft | null>(null)

  const groups = useMemo(() => buildRailGroups(census.data ?? []), [census.data])
  const gatewayRows = useMemo(() => gateways.data ?? [], [gateways.data])
  const gatewaysById = useMemo(
    () => new Map(gatewayRows.map((row) => [row.id, row] as const)),
    [gatewayRows]
  )
  const shared = useMemo(() => sharedClearingAccounts(gatewayRows), [gatewayRows])

  // 🛑 Gate the fee warning on the role map having ANSWERED. "No account holds
  // this role" is a claim about the organization, and making it while the query
  // is still in flight is a false one on the page whose whole job is telling
  // somebody what is left to do.
  const feeRole = roleMap.data?.roles.find(
    (row) => row.role === ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES
  )
  const warnsFeeFallback =
    roleMap.data !== undefined &&
    warnsAboutFeeFallback({
      fallbackMapped: Boolean(feeRole?.accountId),
      gateways: gatewayRows,
      groups,
    })

  const refresh = async () => {
    await Promise.all([
      utils.paymentGateway.list.invalidate(),
      utils.paymentGateway.handleCensus.invalidate(),
      utils.paymentGateway.observedHandles.invalidate(),
      utils.ledger.chartAccounts.invalidate(),
      utils.ledger.roleMap.invalidate(),
    ])
  }

  const createRail = api.paymentGateway.createForRail.useMutation({
    onSuccess: async () => {
      setDraft(null)
      await refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error creating the rail', description: error.message })
    },
  })

  const mergeRail = api.paymentGateway.update.useMutation({
    onSuccess: refresh,
    onError: (error) => {
      toastError({ title: 'Error merging the handles', description: error.message })
    },
  })

  function openDraft(group: RailGroup) {
    setDraft({
      key: group.key,
      name: group.name,
      clearingAccountName: group.suggestion.clearingAccountName,
      mintFeeAccount: defaultMintFeeAccount(group.suggestion.feeTreatment),
      feeAccountName: group.suggestion.feeAccountName,
      markClosed: isStaleRail(group.lastSeenAt),
    })
  }

  function submitDraft(group: RailGroup) {
    if (!draft) return
    createRail.mutate({
      handles: group.handles.map((handle) => handle.handle),
      name: draft.name.trim() || group.name,
      clearingAccountName: draft.clearingAccountName.trim() || group.suggestion.clearingAccountName,
      mintFeeAccount: draft.mintFeeAccount,
      feeAccountName: draft.mintFeeAccount
        ? draft.feeAccountName.trim() || group.suggestion.feeAccountName
        : undefined,
      feeTreatment: group.suggestion.feeTreatment,
      status: draft.markClosed ? 'closed' : 'active',
    })
  }

  function mergeGroup(group: RailGroup) {
    const target = group.mergeInto ? gatewaysById.get(group.mergeInto) : undefined
    if (!target) return
    mergeRail.mutate({ id: target.id, handles: [...target.handles, ...group.mergeHandles] })
  }

  const routed = groups.filter((group) => group.state === 'routed').length
  const isLoading = census.isPending || gateways.isPending

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Every rail that has ever taken money for one of your orders, and which account in your chart
        it clears into. A rail with its own account can be reconciled to zero against its own
        deposits; rails sharing one account cannot be told apart again.
      </p>

      {isLoading ? (
        <EmptySection loading />
      ) : census.isError ? (
        <Alert variant='destructive'>
          <AlertTitle>Could not read the rails on your orders</AlertTitle>
          <AlertDescription>{census.error.message}</AlertDescription>
        </Alert>
      ) : groups.length === 0 ? (
        <EmptySection
          title='No payment rails on your orders yet'
          description='Once orders sync, every gateway they arrived through shows up here with an account to point it at.'
        />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium text-foreground text-sm'>
              {routed} of {groups.length} rails routed
            </span>
            {routed < groups.length && (
              <span className='text-muted-foreground text-sm'>
                An unrouted rail still posts - it just lands in the shared card clearing account
                with everything else.
              </span>
            )}
          </div>

          {warnsFeeFallback && (
            <Alert variant='warning'>
              <AlertTitle>No account holds your processor fees</AlertTitle>
              <AlertDescription>
                A rail whose processor withholds its cut books that fee to the
                {' payment processing fees '}
                role, and no account is mapped to it yet. Nothing here is blocked, but the first
                payout entry will refuse until you map it on the account map.
              </AlertDescription>
            </Alert>
          )}

          {shared.size > 0 && (
            <Alert variant='warning'>
              <AlertTitle>Two rails share one clearing account</AlertTitle>
              <AlertDescription>
                {[...shared.values()]
                  .map((bucket) => bucket.map((row) => row.name || 'Untitled').join(' and '))
                  .join('; ')}
                {
                  ' clear into the same account. That is legal, and it is also why that account can no longer be squared against one deposit.'
                }
              </AlertDescription>
            </Alert>
          )}

          <div className='overflow-hidden rounded-xl border'>
            <ul className='flex flex-col'>
              {groups.map((group) => {
                const claiming = group.claimedBy[0] ? gatewaysById.get(group.claimedBy[0]) : null
                const badge = STATE_BADGE[group.state]
                const isDrafting = draft?.key === group.key
                return (
                  <li key={group.key} className='flex flex-col border-b last:border-b-0'>
                    <div className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'>
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <span className='flex items-center gap-2 truncate font-medium text-sm'>
                          {group.name}
                          <Badge variant={badge.variant} size='sm' className='shrink-0'>
                            {badge.label}
                          </Badge>
                        </span>
                        <span className='truncate text-muted-foreground text-xs'>
                          {group.orderCount.toLocaleString()}{' '}
                          {group.orderCount === 1 ? 'order' : 'orders'}
                          {group.lastSeenAt ? `, last ${group.lastSeenAt}` : ''}
                          {group.handles.length > 1
                            ? ` · ${group.handles.map((handle) => handle.handle).join(', ')}`
                            : ''}
                        </span>
                      </div>

                      <div className='flex shrink-0 items-center gap-2'>
                        {claiming ? (
                          <AccountLabel
                            glAccountId={claiming.clearingGlAccountId}
                            density='compact'
                            fallback='-'
                            className='text-muted-foreground text-xs'
                          />
                        ) : null}
                        {group.mergeInto && (
                          <Button
                            variant='outline'
                            size='sm'
                            loading={mergeRail.isPending}
                            loadingText='Merging...'
                            onClick={() => mergeGroup(group)}>
                            Merge {group.mergeHandles.join(', ')}
                          </Button>
                        )}
                        {group.state === 'unrouted' && !isDrafting && (
                          <Button variant='outline' size='sm' onClick={() => openDraft(group)}>
                            Create account
                          </Button>
                        )}
                      </div>
                    </div>

                    {isDrafting && draft && (
                      <div className='flex flex-col gap-2 border-t bg-muted/40 px-3 py-3'>
                        <FieldPanel
                          orientation='responsive'
                          breakpoint='md'
                          resizeId='accounting-wizard-rail'
                          defaultLabelWidth={150}
                          className='bg-background p-0'>
                          <FieldPanelRow
                            title='Rail name'
                            type={BaseType.STRING}
                            showIcon
                            isRequired>
                            <FieldInputAdapter
                              fieldType={FieldType.TEXT}
                              value={draft.name}
                              disabled={createRail.isPending}
                              onChange={(value) =>
                                setDraft({ ...draft, name: (value as string) ?? '' })
                              }
                            />
                          </FieldPanelRow>
                          <FieldPanelRow
                            title='Clearing account'
                            type={BaseType.STRING}
                            showIcon
                            isRequired
                            description='A new asset account, minted with the next free code in the clearing band and no role - an account reached by id, through this record.'>
                            <FieldInputAdapter
                              fieldType={FieldType.TEXT}
                              value={draft.clearingAccountName}
                              disabled={createRail.isPending}
                              onChange={(value) =>
                                setDraft({
                                  ...draft,
                                  clearingAccountName: (value as string) ?? '',
                                })
                              }
                            />
                          </FieldPanelRow>
                        </FieldPanel>

                        <label className='flex items-start gap-2 rounded-md p-1'>
                          <Checkbox
                            className='mt-0.5'
                            checked={draft.mintFeeAccount}
                            onCheckedChange={(value) =>
                              setDraft({ ...draft, mintFeeAccount: value === true })
                            }
                          />
                          <span className='flex min-w-0 flex-col'>
                            <span className='text-sm'>Give this rail its own fee account</span>
                            {/* 🛑 §5's defaults are asymmetric and each side has its
                                own reason. Say the reason rather than the default. */}
                            <span className='text-muted-foreground text-xs'>
                              {group.suggestion.feeTreatment === 'billed'
                                ? 'This rail bills its fees separately, so its own account is what makes "has it billed us this month" a one-line answer.'
                                : 'This rail withholds its fee from every deposit, so it is booked automatically and your shared processor-fees account is usually enough.'}
                            </span>
                          </span>
                        </label>

                        {draft.mintFeeAccount && (
                          <FieldPanel
                            orientation='responsive'
                            breakpoint='md'
                            resizeId='accounting-wizard-rail'
                            defaultLabelWidth={150}
                            className='bg-background p-0'>
                            <FieldPanelRow
                              title='Fee account'
                              type={BaseType.STRING}
                              showIcon
                              isRequired>
                              <FieldInputAdapter
                                fieldType={FieldType.TEXT}
                                value={draft.feeAccountName}
                                disabled={createRail.isPending}
                                onChange={(value) =>
                                  setDraft({ ...draft, feeAccountName: (value as string) ?? '' })
                                }
                              />
                            </FieldPanelRow>
                          </FieldPanel>
                        )}

                        <label className='flex items-start gap-2 rounded-md p-1'>
                          <Checkbox
                            className='mt-0.5'
                            checked={draft.markClosed}
                            onCheckedChange={(value) =>
                              setDraft({ ...draft, markClosed: value === true })
                            }
                          />
                          <span className='flex min-w-0 flex-col'>
                            <span className='text-sm'>Mark this rail closed</span>
                            <span className='text-muted-foreground text-xs'>
                              Its history keeps posting to this same account so the balance still
                              winds down. It just stops being offered for a new order.
                            </span>
                          </span>
                        </label>

                        <div className='flex items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            loading={createRail.isPending}
                            loadingText='Creating...'
                            disabled={
                              !draft.name.trim() ||
                              !draft.clearingAccountName.trim() ||
                              (draft.mintFeeAccount && !draft.feeAccountName.trim())
                            }
                            onClick={() => submitDraft(group)}>
                            Create account and route it
                          </Button>
                          <Button
                            variant='ghost'
                            size='sm'
                            disabled={createRail.isPending}
                            onClick={() => setDraft(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      <p className='text-muted-foreground text-xs'>
        Orders paid by hand debit receivables instead and are not a rail, so they never appear here.
        Everything on this page can be changed later on{' '}
        <Link href={GATEWAYS_HREF} className='underline'>
          payment gateways
        </Link>
        .
      </p>

      <div>
        <Button variant='outline' size='sm' asChild>
          <Link href={GATEWAYS_HREF}>
            Open payment gateways
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
