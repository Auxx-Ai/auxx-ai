// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-rails-page.tsx
'use client'

import { ACCOUNT_ROLES } from '@auxx/lib/accounting/ledger/client'
import { PROCESSORS } from '@auxx/lib/accounting/processors/client'
import { normaliseGatewayHandle } from '@auxx/lib/accounting/rails/client'
import {
  buildRailGroups,
  isStaleRail,
  type RailGroup,
} from '@auxx/lib/accounting/rails/rail-groups'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { CreditCard, Store } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { AccountLabel } from '../account-label'
import { MappingAccountSelect } from '../settings/mapping-account-select'
import { PaymentGatewayAddDialog } from '../settings/payment-gateway-add-dialog'
import { RailFeedNote } from '../settings/rail-feed-note'
import type { ConnectAndGoFlow } from './use-connect-and-go'

const GATEWAYS_HREF = '/app/accounting/settings/payment-gateways'

// Only processors an app can read; one without a feed app has nothing to install.
const INSTALLABLE_PROCESSORS = PROCESSORS.filter((processor) => processor.feedApp)

/**
 * Every payment gateway and where it pays out, the rails still to set up, and the processors not
 * connected yet. Never blocks: a rail is only auto-routed onto accounts that already exist by name,
 * and every other one is set up here, picking or creating its accounts.
 */
export function ConnectAndGoRailsPage({ flow }: { flow: ConnectAndGoFlow }) {
  const { can } = useAccess()
  const canControl = can(PermissionKey.ledgerControl)
  const gateways = api.paymentGateway.list.useQuery({ withFeed: true })
  const roleMap = api.ledger.roleMap.useQuery()
  const processorFeeds = api.paymentGateway.feedStateForHandles.useQuery({
    groups: INSTALLABLE_PROCESSORS.map((processor) => [...processor.handles]),
  })

  const census = api.paymentGateway.handleCensus.useQuery()
  const [setUpGroup, setSetUpGroup] = useState<RailGroup | null>(null)
  const unrouted = useMemo(
    () => buildRailGroups(census.data ?? []).filter((group) => group.state === 'unrouted'),
    [census.data]
  )

  const questions = flow.report?.questions.rails ?? []
  const bankQuestions = new Set(
    questions.flatMap((row) => (row.kind === 'rail_bank' ? [row.gatewayId] : []))
  )
  const splits = questions.filter((row) => row.kind === 'rail_split')

  const railBanks = useMemo(() => {
    const bank = roleMap.data?.roles.find((row) => row.role === ACCOUNT_ROLES.BANK)
    return new Map(
      (bank?.railOverrides ?? [])
        .filter((row) => row.currency === null)
        .map((row) => [row.paymentGatewayId, row.accountId] as const)
    )
  }, [roleMap.data])

  const gatewayByHandle = useMemo(
    () =>
      new Map(
        (gateways.data ?? []).flatMap((gateway) =>
          gateway.handles.map((handle) => [normaliseGatewayHandle(handle), gateway] as const)
        )
      ),
    [gateways.data]
  )

  const rows = gateways.data ?? []

  return (
    <div className='flex flex-col'>
      <Section
        title='Payment gateways'
        description='Each rail clears into its own account and pays out to a bank account.'
        icon={<CreditCard className='size-4 text-muted-foreground' />}
        collapsible={false}>
        {gateways.isPending ? (
          <EmptySection loading />
        ) : rows.length === 0 && splits.length === 0 && unrouted.length === 0 ? (
          <EmptySection
            title='No payment gateways yet'
            description='The rails on your orders show up here after the first order sync.'
          />
        ) : (
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-connect-and-go-rails'
            defaultLabelWidth={170}
            className='p-0'>
            {rows.map((gateway) => (
              <FieldPanelRow
                key={gateway.id}
                title={gateway.name || 'Untitled'}
                type={BaseType.ENUM}
                showIcon>
                <div className='flex min-w-0 flex-col gap-1 py-1'>
                  {bankQuestions.has(gateway.id) ? (
                    <MappingAccountSelect
                      triggerClassName='w-full ps-0 pe-1'
                      value={flow.draft.railBanks[gateway.id] ?? null}
                      filterTypes={['asset']}
                      subtypePin='bank'
                      newAccountFor={{ role: 'bank', scopeLabel: gateway.name || undefined }}
                      disabled={flow.finishing}
                      onChange={(value) =>
                        flow.patchDraft({
                          railBanks: {
                            ...flow.draft.railBanks,
                            [gateway.id]: value === 'inherit' ? null : value,
                          },
                        })
                      }
                    />
                  ) : (
                    <span className='flex min-w-0 gap-1 text-sm'>
                      <span className='shrink-0 text-muted-foreground'>Pays out to</span>
                      <AccountLabel glAccountId={railBanks.get(gateway.id)} density='compact' />
                    </span>
                  )}
                  <span className='flex min-w-0 flex-wrap gap-x-1 text-muted-foreground text-xs'>
                    <span>Clears into</span>
                    <AccountLabel glAccountId={gateway.clearingGlAccountId} density='compact' />
                    {gateway.feeGlAccountId && (
                      <>
                        <span>· fees to</span>
                        <AccountLabel glAccountId={gateway.feeGlAccountId} density='compact' />
                      </>
                    )}
                    {gateway.status === 'closed' && <span>· closed</span>}
                    {canControl && (
                      <Link
                        href={`${GATEWAYS_HREF}?gateway=${gateway.id}`}
                        className='underline underline-offset-2'>
                        Change accounts
                      </Link>
                    )}
                  </span>
                  <RailFeedNote
                    feed={gateway.feed}
                    gatewayId={gateway.id}
                    canControl={canControl}
                  />
                </div>
              </FieldPanelRow>
            ))}
            {unrouted.map((group) => (
              <FieldPanelRow
                key={`unrouted:${group.key}`}
                title={group.name}
                type={BaseType.ENUM}
                showIcon>
                <div className='flex min-w-0 flex-wrap items-center justify-between gap-2 py-1'>
                  <span className='text-muted-foreground text-xs'>
                    Not routed: {group.orderCount.toLocaleString()}{' '}
                    {group.orderCount === 1 ? 'order' : 'orders'} land in the shared clearing
                    account.
                  </span>
                  {canControl && (
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={flow.finishing}
                      onClick={() => setSetUpGroup(group)}>
                      Set up
                    </Button>
                  )}
                </div>
              </FieldPanelRow>
            ))}
            {splits.map(
              (question) =>
                question.kind === 'rail_split' && (
                  <FieldPanelRow
                    key={`split:${question.name}`}
                    title={question.name}
                    type={BaseType.STRING}
                    showIcon>
                    <p className='py-1.5 text-muted-foreground text-xs'>
                      Split across {question.gatewayIds.length} gateways
                      {question.unclaimedHandles.length > 0
                        ? `; ${question.unclaimedHandles.join(', ')} unrouted`
                        : ''}
                      .{' '}
                      <Link href={GATEWAYS_HREF} className='underline underline-offset-2'>
                        Review in payment gateways
                      </Link>
                    </p>
                  </FieldPanelRow>
                )
            )}
          </FieldPanel>
        )}
      </Section>

      <Section
        title='Sales channels and payment apps'
        className='[&_[data-slot=section]]:border-b-0'
        description='Connect the apps your payments run through. Their rails appear above after the first order sync.'
        icon={<Store className='size-4 text-muted-foreground' />}
        collapsible={false}>
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-connect-and-go-rails'
          defaultLabelWidth={170}
          className='p-0'>
          {INSTALLABLE_PROCESSORS.map((processor, index) => {
            const gateway = processor.handles
              .map((handle) => gatewayByHandle.get(handle))
              .find((row) => row !== undefined)
            const feed = processorFeeds.data?.[index]
            return (
              <FieldPanelRow
                key={processor.id}
                title={processor.label}
                type={BaseType.STRING}
                showIcon>
                <div className='py-1.5 text-muted-foreground text-xs'>
                  {gateway ? (
                    `Set up as ${gateway.name || 'Untitled'}.`
                  ) : processorFeeds.isPending ? (
                    'Checking...'
                  ) : feed?.state === 'linked' || feed?.state === 'syncing' ? (
                    'Connected. Its rail appears above after the first order sync.'
                  ) : feed?.state === 'none' ? (
                    'No app for it is available yet.'
                  ) : (
                    <RailFeedNote feed={feed} canControl={canControl} />
                  )}
                </div>
              </FieldPanelRow>
            )
          })}
        </FieldPanel>
      </Section>
      <PaymentGatewayAddDialog
        open={setUpGroup !== null}
        onOpenChange={(open) => {
          if (!open) setSetUpGroup(null)
        }}
        onCreated={() => void census.refetch()}
        initialHandles={setUpGroup?.handles.map((handle) => handle.handle)}
        status={setUpGroup && isStaleRail(setUpGroup.lastSeenAt) ? 'closed' : 'active'}
      />
    </div>
  )
}
