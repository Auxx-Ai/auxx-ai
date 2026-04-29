// apps/web/src/components/today/today-page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import { api } from '~/trpc/react'
import { BundleCard, type BundleCardData } from './bundle-card'

/**
 * Today landing — the daily-triage list of FRESH AI bundles. Approve fires
 * the bundle's full action chain; reject closes the bundle without firing
 * anything (the bundle's soft-tool side effects, e.g. Drafts, are NOT
 * deleted in v1 — Open Q13 deferred).
 */
export function TodayPage() {
  const list = api.approvals.list.useQuery({
    filters: { ownerScope: 'mine_and_unassigned', status: ['FRESH'] },
    limit: 25,
  })
  const pending = api.approvals.listPending.useQuery({ mineOnly: true })

  return (
    <div className='max-w-3xl mx-auto py-8 px-4 flex flex-col gap-4'>
      <header className='flex items-end justify-between'>
        <div>
          <h1 className='text-2xl font-semibold'>Today</h1>
          <p className='text-sm text-muted-foreground'>
            AI-proposed next actions for accounts that have gone quiet.
          </p>
        </div>
        {pending.data && pending.data.items.length > 0 && (
          <Link href='/app/today/pending'>
            <Button variant='outline' size='sm'>
              {pending.data.items.length} pending send
              {pending.data.items.length === 1 ? '' : 's'}
            </Button>
          </Link>
        )}
      </header>

      {list.isLoading && <div className='text-sm text-muted-foreground'>Loading…</div>}
      {list.data && list.data.items.length === 0 && (
        <div className='text-sm text-muted-foreground'>Nothing to triage.</div>
      )}
      <div className='flex flex-col gap-3'>
        {list.data?.items.map((row) => (
          <BundleCard key={row.id} bundle={row as unknown as BundleCardData} />
        ))}
      </div>
    </div>
  )
}
