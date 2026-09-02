// apps/web/src/components/purchasing/intake/ui/intake-draft-banner.tsx
'use client'

// "1 quote waiting for review" on the purchase orders list (plans/money/tasks/38 §6.1).
//
// ⚠️ It reads a `localStorage` pointer, not a list. There is no `listDrafts`
// procedure and there should not be one: the draft row is server-side because the
// worker writes it while the tab may be closed, but nothing indexes "my open
// drafts". The banner is therefore device-local — upload on the laptop and it
// does not appear on the phone. For a 40-second job that is the accepted trade.
//
// A pointer whose draft is gone — committed here or elsewhere, or expired off its
// 24h Redis TTL — is forgotten on sight rather than rendered as a dead link. That
// TTL matches the temp upload's, and the two go together on purpose: a draft that
// outlived its own document would open a live table beside a dead preview pane.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { FileText, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { removeIntakePointer, useIntakePointers } from '../hooks/use-intake-pointer'

export function IntakeDraftBanner() {
  const pointers = useIntakePointers()
  // Newest only. A stack of banners for a surface with no history page is a list
  // by another name, and §6.1 says not to build one.
  const latest = pointers[0]

  if (!latest) return null
  return <IntakeDraftBannerRow key={latest.draftId} draftId={latest.draftId} />
}

function IntakeDraftBannerRow({ draftId }: { draftId: string }) {
  const draft = api.purchasing.getIntakeDraft.useQuery(
    { draftId },
    {
      retry: false,
      refetchInterval: (query) => (query.state.data?.status === 'reading' ? 3000 : false),
    }
  )

  const status = draft.data?.status
  const isGone = draft.isError || status === 'committed'

  useEffect(() => {
    if (isGone) removeIntakePointer(draftId)
  }, [isGone, draftId])

  if (draft.isLoading || isGone || !draft.data) return null

  const vendor = draft.data.payload?.transcription.vendorName ?? draft.data.fileName ?? 'A quote'

  return (
    <div className='flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm'>
      <FileText className='size-4 text-muted-foreground' />
      <span className='min-w-0 truncate'>{vendor}</span>
      {status === 'reading' ? (
        <Badge variant='blue' size='sm'>
          Reading
        </Badge>
      ) : status === 'failed' ? (
        <Badge variant='red' size='sm'>
          Could not be read
        </Badge>
      ) : (
        <Badge variant='amber' size='sm'>
          Waiting for review
        </Badge>
      )}
      <div className='ml-auto flex items-center gap-1'>
        <Button variant='outline' size='xs' asChild>
          <Link href={`/app/purchase-orders/intake/${draftId}`}>Review</Link>
        </Button>
        {/* Dismisses the POINTER, never the draft: the review URL still works and
            the server row is untouched until it is discarded or swept. */}
        <Button variant='ghost' size='icon-xs' onClick={() => removeIntakePointer(draftId)}>
          <X />
        </Button>
      </div>
    </div>
  )
}
