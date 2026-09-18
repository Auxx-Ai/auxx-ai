// apps/web/src/components/accounting/ui/reports/posting-drawer-host.tsx

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { PostingDrawer } from '~/components/accounting/ui/ledger/posting-drawer'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'

/** Owns `?posting=<id>` for a report that opens a posting without leaving the page. */
export function usePostingDrawer() {
  const [postingId, setPostingId] = useQueryState('posting')
  const open = useCallback((glPostingId: string) => void setPostingId(glPostingId), [setPostingId])
  const close = useCallback(() => void setPostingId(null), [setPostingId])
  return { postingId, open, close }
}

interface PostingDrawerHostProps {
  postingId: string | null
  onClose: () => void
  onSelectPosting: (glPostingId: string) => void
}

/**
 * `PostingDrawer` on a report, with the org-level props every report would
 * otherwise re-derive.
 *
 * Docked, the drawer is published to the reports layout's outlet: a docked
 * `DockableDrawer` with no portal target renders its children inline, which puts
 * the panel in the middle of the statement.
 */
export function PostingDrawerHost({ postingId, onClose, onSelectPosting }: PostingDrawerHostProps) {
  const period = useLedgerPeriod()
  const provider = useAccountingProviderStatus()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const utils = api.useUtils()
  const router = useRouter()

  const reverse = api.ledger.reverse.useMutation({
    onSuccess: () => {
      if (postingId) void utils.ledger.get.invalidate({ id: postingId })
      void utils.ledgerReports.invalidate()
    },
    onError: (error) =>
      toastError({ title: 'The reversal could not be sent', description: error.message }),
  })

  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const { currencyCode, bookTimeZone } = period
  const isReversing = reverse.isPending
  const reverseMutate = reverse.mutate

  const drawer = useMemo(
    () => (
      <PostingDrawer
        postingId={postingId}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        onSelectPosting={onSelectPosting}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
        providerLabel={providerLabel}
        onOpenOutbox={(tab) => router.push(`/app/accounting?queue=${tab}`)}
        onReverse={(memo) => {
          if (!postingId) return
          reverseMutate({ glPostingId: postingId, memo: memo.trim() || undefined })
        }}
        isReversing={isReversing}
      />
    ),
    [
      postingId,
      onClose,
      onSelectPosting,
      isDocked,
      dockedWidth,
      setDockedWidth,
      currencyCode,
      bookTimeZone,
      providerLabel,
      router,
      reverseMutate,
      isReversing,
    ]
  )

  /**
   * ⚠️ `overlay: true` unconditionally. The panel only DOCKS when there is a
   * posting, but the overlay node stays mounted either way so `DockableDrawer`
   * can animate itself shut on its own `open={!!postingId}` - unmounting it the
   * moment the id clears would cut that exit short.
   *
   * Memoised: a fresh array every render re-runs the outlet's publish effect.
   */
  const panels = useMemo(
    () => [
      {
        key: 'posting',
        open: { docked: !!postingId, overlay: true },
        content: drawer,
        width: { value: dockedWidth, set: setDockedWidth, min: 380, max: 800 },
      },
    ],
    [postingId, drawer, dockedWidth, setDockedWidth]
  )
  const { dockedPanels, overlays } = useDockedPanels(panels)
  useRegisterDockedPanels(dockedPanels)

  return overlays
}
