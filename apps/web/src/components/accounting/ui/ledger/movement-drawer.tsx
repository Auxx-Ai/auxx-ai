// apps/web/src/components/accounting/ui/ledger/movement-drawer.tsx

'use client'

import type { CloseBlockerItem } from '@auxx/lib/accounting/ledger/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { CalendarClock, CircleAlert, Clock, Coins, Link2, RefreshCw } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { api, type RouterOutputs } from '~/trpc/react'
import { EntryBlockers } from './entry-blockers'
import { formatAccountingDate, formatAuditTimestamp, formatMinor } from './format'

type BlockedMovementDetail = NonNullable<RouterOutputs['ledger']['getBlockedMovement']>

export const MOVEMENT_PURPOSE_LABEL: Record<BlockedMovementDetail['purpose'], string> = {
  customer_receipt: 'Customer payment',
  customer_refund: 'Customer refund',
  vendor_payment: 'Vendor payment',
  vendor_refund: 'Vendor refund',
}

const LINK_ROLE_LABEL: Record<BlockedMovementDetail['links'][number]['role'] | 'party', string> = {
  party: 'party',
  cash_account: 'cash account',
  order: 'order',
  invoice: 'invoice',
  vendor_bill: 'vendor bill',
  quote: 'quote',
}

/**
 * The roles named in an `account_unmapped` refusal, as the remedy card's items.
 *
 * ⚠️ Parsed back out of the sentence because the reason is all the movement
 * stores - `resolve-roles.ts` writes one `'role' (Label) …` clause per offending
 * role, and widening `MoneyTransaction` to carry the list is not worth a column.
 */
function unmappedRoleItems(reason: string): CloseBlockerItem[] {
  const items: CloseBlockerItem[] = []
  for (const match of reason.matchAll(/'([a-z0-9_]+)'\s*(\([^)]*\))?([^']*)/g)) {
    const role = match[1]
    if (!role || items.some((item) => item.ref === role)) continue
    items.push({
      key: 'unmapped_role',
      label: match[2] ? `${role} ${match[2]}` : role,
      remedy: match[3]?.trim() || 'It is not mapped to any account.',
      ref: role,
    })
  }
  return items
}

interface MovementDrawerProps {
  /** From `?movement=<id>`. `null` closes the drawer. */
  movementId: string | null
  onOpenChange: (open: boolean) => void
  /** A retry that is accepted or drafted lands on a posting - open it in this slot. */
  onSelectPosting: (glPostingId: string) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  bookTimeZone: string
}

/**
 * One movement the ledger refused, deep-linked on `?movement=<id>` in the same
 * dock slot as the posting drawer (75-D1). The reason in `postEntry`'s own
 * words, the remedy card for an unmapped role, the records the money touched,
 * and Retry - the one action a parked movement has.
 */
export function MovementDrawer({
  movementId,
  onOpenChange,
  onSelectPosting,
  isDocked,
  width,
  onWidthChange,
  bookTimeZone,
}: MovementDrawerProps) {
  const utils = api.useUtils()
  const detailQuery = api.ledger.getBlockedMovement.useQuery(
    { moneyTransactionId: movementId ?? '' },
    { enabled: !!movementId }
  )
  const detail = detailQuery.data ?? null

  const retry = api.ledger.retryBlockedMovement.useMutation({
    onSuccess: (result) => {
      void utils.ledger.listBlockedMovements.invalidate()
      void utils.ledger.listDrafts.invalidate()
      void utils.ledger.listPostings.invalidate()
      void utils.ledger.outboxCounts.invalidate()
      if (result.status === 'accepted' || result.status === 'drafted') {
        onSelectPosting(result.glPostingId)
        return
      }
      toastError({ title: 'Still not posted', description: result.reason })
      void utils.ledger.getBlockedMovement.invalidate()
    },
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  const date = detail ? (detail.occurredOn ?? detail.occurredAt?.toISOString() ?? null) : null
  const partyRole = detail?.purpose.startsWith('customer') ? 'customer' : 'vendor'
  const links = detail
    ? [
        ...(detail.partyInstanceId
          ? [
              {
                role: 'party' as const,
                instanceId: detail.partyInstanceId,
                definitionId: detail.partyDefinitionId,
                displayName: detail.partyName,
              },
            ]
          : []),
        ...detail.links,
      ]
    : []

  return (
    <DockableDrawer
      open={!!movementId}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={720}
      title={detail ? MOVEMENT_PURPOSE_LABEL[detail.purpose] : 'Movement'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<CircleAlert className='size-5 text-destructive' />}
          title={
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>
                {detail ? MOVEMENT_PURPOSE_LABEL[detail.purpose] : 'Movement'}
              </span>
              {detail && (
                <Badge variant='destructive' size='sm'>
                  Blocked
                </Badge>
              )}
            </div>
          }
          actions={
            detail && (
              <div className='flex items-center gap-1'>
                <Tooltip content='Post this movement again'>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    aria-label='Post this movement again'
                    disabled={retry.isPending}
                    onClick={() => retry.mutate({ moneyTransactionId: detail.id })}>
                    <RefreshCw className={retry.isPending ? 'animate-spin' : undefined} />
                  </Button>
                </Tooltip>
              </div>
            )
          }
          onClose={() => onOpenChange(false)}
        />

        {detailQuery.isPending && movementId ? (
          <div className='flex flex-col gap-2 p-4'>
            <Skeleton className='h-20 w-full' />
            <Skeleton className='h-40 w-full' />
          </div>
        ) : !detail ? (
          <div className='p-4 text-muted-foreground text-sm'>
            No refused movement matches this link. It may have posted since.
          </div>
        ) : (
          <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
            <div className='flex flex-col'>
              <MetricGrid columns={2}>
                <MetricCell
                  label='Date'
                  icon={<CalendarClock className='size-4 text-muted-foreground' />}
                  value={date ? formatAccountingDate(date, bookTimeZone) : '—'}
                />
                <MetricCell
                  label='Amount'
                  icon={<Coins className='size-4 text-muted-foreground' />}
                  value={formatMinor(detail.amountMinor, detail.currency)}
                />
                <MetricCell
                  label='Refused'
                  icon={<Clock className='size-4 text-muted-foreground' />}
                  className='col-span-2'
                  value={
                    detail.blockedAt
                      ? formatAuditTimestamp(detail.blockedAt.toISOString(), bookTimeZone)
                      : '—'
                  }
                />
              </MetricGrid>

              <Section
                title='Why it was refused'
                icon={<CircleAlert className='size-4' />}
                description='In the ledger’s own words. Retry once the cause is fixed.'
                collapsible={false}>
                {detail.reasonKind === 'account_unmapped' ? (
                  // The card's per-role row deep-links to that role under
                  // Settings > Accounts > Roles - that IS the Map action.
                  <EntryBlockers
                    blockers={[
                      {
                        status: 'account_unmapped',
                        error: detail.reason,
                        items: unmappedRoleItems(detail.reason),
                      },
                    ]}
                  />
                ) : (
                  <p className='text-sm'>{detail.reason}</p>
                )}
              </Section>

              {links.length > 0 && (
                <Section
                  title='Links'
                  icon={<Link2 className='size-4' />}
                  description='The records this movement touches.'
                  collapsible={false}>
                  <TreeRowList
                    items={links}
                    getKey={(link) => `${link.role}-${link.instanceId}`}
                    renderRow={(link) => (
                      <TreeRow
                        title={
                          link.definitionId ? (
                            <RecordBadge
                              recordId={toRecordId(link.definitionId, link.instanceId)}
                              size='sm'
                            />
                          ) : (
                            <span className='font-mono text-xs'>
                              {link.displayName ?? link.instanceId}
                            </span>
                          )
                        }
                        trailing={
                          <Badge variant='outline' size='xs'>
                            {link.role === 'party' ? partyRole : LINK_ROLE_LABEL[link.role]}
                          </Badge>
                        }
                      />
                    )}
                  />
                </Section>
              )}

              {/* Channel money's `reference` is the provider's own id; only a hand-recorded payment carries one somebody typed. */}
              {((detail.method && detail.reference) || detail.note) && (
                <Section title='Notes' collapsible={false}>
                  <div className='flex flex-col gap-1 text-sm'>
                    {detail.method && detail.reference && (
                      <span>
                        <span className='text-muted-foreground'>Reference </span>
                        <span className='font-mono text-xs'>{detail.reference}</span>
                      </span>
                    )}
                    {detail.note && <p>{detail.note}</p>}
                  </div>
                </Section>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </DockableDrawer>
  )
}
