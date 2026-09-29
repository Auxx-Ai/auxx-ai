// apps/web/src/components/accounting/ui/settings/unlinked-feeds-row.tsx
'use client'

import { processorByProviderKey } from '@auxx/lib/accounting/processors/client'
import { normaliseGatewayHandle } from '@auxx/lib/accounting/rails/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowUpRight, CreditCard, Unlink } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { WARNING_BUTTON, WARNING_RING, WARNING_ROW } from '../tone-rows'

const GATEWAYS_HREF = '/app/accounting/settings/payment-gateways'

/** Processor feeds no rail has claimed; each links to the one gateway its processor's handles name. */
export function UnlinkedFeedsRow({ canControl }: { canControl: boolean }) {
  const feeds = api.paymentGateway.listUnlinkedFeeds.useQuery()
  const gateways = api.paymentGateway.list.useQuery()
  const utils = api.useUtils()
  const [open, setOpen] = useState(true)
  const [linkingId, setLinkingId] = useState<string | null>(null)

  const linkFeed = api.paymentGateway.linkFeed.useMutation({
    onSettled: () => setLinkingId(null),
    onSuccess: () =>
      Promise.all([
        utils.paymentGateway.listUnlinkedFeeds.invalidate(),
        utils.paymentGateway.list.invalidate(),
        utils.paymentGateway.readiness.invalidate(),
        utils.paymentGateway.feedStateForHandles.invalidate(),
      ]),
    onError: (error) => toastError({ title: 'Error linking the feed', description: error.message }),
  })

  const gatewayFor = useMemo(() => {
    const rows = gateways.data ?? []
    return (providerKey: string) => {
      const handles = new Set(processorByProviderKey(providerKey)?.handles ?? [])
      const matches = rows.filter((row) =>
        row.handles.some((handle) => handles.has(normaliseGatewayHandle(handle)))
      )
      return matches.length === 1 ? matches[0] : null
    }
  }, [gateways.data])

  const rows = feeds.data ?? []
  if (rows.length === 0) return null

  return (
    <TreeRow
      expandable
      isOpen={open}
      onToggleOpen={() => setOpen((value) => !value)}
      rowClassName={cn(WARNING_ROW, WARNING_RING)}
      icon={<Unlink className='size-4 text-yellow-600 dark:text-yellow-500' />}
      title={
        <span className='truncate text-amber-800 dark:text-amber-400'>
          {rows.length} processor {rows.length === 1 ? "feed isn't" : "feeds aren't"} linked to a
          payment gateway
        </span>
      }
      description="Payouts they report can't be matched to customer payments.">
      <TreeRowList
        items={rows}
        getKey={(feed) => feed.processorAccountId}
        renderRow={(feed) => {
          const gateway = gatewayFor(feed.providerKey)
          const label = processorByProviderKey(feed.providerKey)?.label ?? feed.providerKey
          return (
            <TreeRow
              depth={1}
              icon={<CreditCard className='size-4 text-muted-foreground' />}
              title={<span className='truncate text-sm'>{feed.name ?? label}</span>}
              secondary={
                <span className='truncate text-muted-foreground text-xs'>
                  {label} · {feed.externalAccountId}
                </span>
              }
              actions={
                canControl &&
                (gateway ? (
                  <Button
                    variant='ghost'
                    size='xs'
                    className={WARNING_BUTTON}
                    loading={linkingId === feed.processorAccountId}
                    loadingText='Linking...'
                    disabled={linkFeed.isPending}
                    onClick={() => {
                      setLinkingId(feed.processorAccountId)
                      linkFeed.mutate({
                        gatewayId: gateway.id,
                        sourceAccountId: feed.processorAccountId,
                      })
                    }}>
                    Link to {gateway.name || 'gateway'}
                  </Button>
                ) : (
                  <Button variant='ghost' size='xs' className={WARNING_BUTTON} asChild>
                    <Link href={GATEWAYS_HREF}>
                      Set up gateway
                      <ArrowUpRight />
                    </Link>
                  </Button>
                ))
              }
            />
          )
        }}
      />
    </TreeRow>
  )
}
