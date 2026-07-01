// apps/web/src/components/drawers/cards/contact-external-identities-card.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Link2 } from 'lucide-react'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * ContactExternalIdentitiesCard — the multi-source answer: every external
 * system this record is linked to, grouped app → connection. Backed by the
 * `RecordIdentity` index (`record.getIdentities`). The identity *values* still
 * render as normal cells in the field grid; this card surfaces the full link
 * set (e.g. Shopify-US + Shopify-EU + chat at once) that plain per-connection
 * cells can't show as one group.
 *
 * Renders nothing when the record has no external identities.
 */
export function ContactExternalIdentitiesCard({ recordId }: DrawerTabProps) {
  const { data: identities, isLoading } = api.record.getIdentities.useQuery({ recordId })

  if (isLoading) {
    return (
      <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
        <div className='flex items-center gap-3'>
          <Skeleton className='size-8 rounded-lg' />
          <div className='flex flex-col gap-1'>
            <Skeleton className='h-4 w-28' />
            <Skeleton className='h-3 w-40' />
          </div>
        </div>
      </div>
    )
  }

  if (!identities || identities.length === 0) return null

  // Group by (source, connectionId) — one block per app/store.
  const groups = new Map<string, typeof identities>()
  for (const identity of identities) {
    const key = `${identity.source}:${identity.connectionId ?? ''}`
    const existing = groups.get(key)
    if (existing) existing.push(identity)
    else groups.set(key, [identity])
  }

  return (
    <div className='flex flex-col gap-2'>
      {[...groups.values()].map((group) => {
        const head = group[0]
        const label = head.appName ?? head.source
        const connectionLabel = head.connectionLabel
        return (
          <div
            key={`${head.source}:${head.connectionId ?? ''}`}
            className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
            <div className='flex items-center gap-3'>
              <Avatar className='size-8 rounded-lg border bg-muted'>
                {head.appIconKey ? (
                  <AvatarImage src={head.appIconKey} alt={label} className='rounded-lg' />
                ) : null}
                <AvatarFallback className='rounded-lg bg-transparent'>
                  <Link2 className='size-4 text-muted-foreground' />
                </AvatarFallback>
              </Avatar>
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium capitalize'>{label}</span>
                {connectionLabel ? (
                  <span className='text-muted-foreground text-xs'>{connectionLabel}</span>
                ) : null}
              </div>
            </div>
            <div className='mt-1.5 flex flex-col gap-1'>
              {group.map((identity) => (
                <div key={identity.id} className='flex items-center justify-between gap-2 text-xs'>
                  <span className='text-muted-foreground shrink-0'>
                    {identity.fieldLabel ?? identity.appFieldKey ?? 'ID'}
                  </span>
                  <span className='font-mono truncate'>{identity.externalId}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
