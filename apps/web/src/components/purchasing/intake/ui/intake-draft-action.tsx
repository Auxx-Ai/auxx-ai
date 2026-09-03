// apps/web/src/components/purchasing/intake/ui/intake-draft-action.tsx
'use client'

// "1 quote waiting for review" on the purchase orders list (plans/money/tasks/38 §6.1).
//
// 🛑 It lives in the HEADER, not above the table. `MainPageAction` portals it
// into the action cluster the layout's `MainPageHeader` mounts, beside "Read a
// quote" and Create. As a full-width strip it was a second row that pushed the
// table down and read as a page-level alert — the review screen keeps the same
// draft on one header line, and the list has no reason to disagree with it.
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

import { Button } from '@auxx/ui/components/button'
import { MainPageAction } from '@auxx/ui/components/main-page'
import { FileText, Loader2, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { removeIntakePointer, useIntakePointers } from '../hooks/use-intake-pointer'

export function IntakeDraftAction() {
  const pointers = useIntakePointers()
  // Newest only. A stack of these for a surface with no history page is a list
  // by another name, and §6.1 says not to build one.
  const latest = pointers[0]

  if (!latest) return null
  return <IntakeDraftRow key={latest.draftId} draftId={latest.draftId} />
}

function IntakeDraftRow({ draftId }: { draftId: string }) {
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
    // Ahead of `RecordsView`'s own group (order 10), so the pending quote sits
    // left of "Read a quote" and Create — the primary action stays rightmost.
    <MainPageAction order={5}>
      <Button variant='outline' size='sm' asChild>
        <Link href={`/app/purchase-orders/intake/${draftId}`}>
          {status === 'reading' ? (
            <Loader2 className='animate-spin' />
          ) : status === 'failed' ? (
            <TriangleAlert />
          ) : (
            <FileText />
          )}
          {/* The header is one 44px row that scrolls horizontally rather than
              wrapping, so a long vendor name has to be capped here. */}
          <span className='max-w-[12rem] truncate'>
            {status === 'reading'
              ? `Reading ${vendor}`
              : status === 'failed'
                ? 'A quote could not be read'
                : `Review ${vendor}`}
          </span>
        </Link>
      </Button>
      {/* Dismisses the POINTER, never the draft: the review URL still works and
          the server row is untouched until it is discarded or swept. */}
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label='Dismiss this quote'
        onClick={() => removeIntakePointer(draftId)}>
        <X />
      </Button>
    </MainPageAction>
  )
}
