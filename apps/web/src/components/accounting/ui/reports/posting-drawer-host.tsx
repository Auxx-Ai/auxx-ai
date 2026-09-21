// apps/web/src/components/accounting/ui/reports/posting-drawer-host.tsx

'use client'

import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { LedgerDrawerHost } from '~/components/accounting/ui/ledger/ledger-drawer-host'
import { outboxHref } from '~/components/accounting/ui/ledger/outbox-route'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { toFrame } from '~/components/records/record-drill-panels'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'

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
}

/**
 * `LedgerDrawerHost` on a report, with the org-level props every report would
 * otherwise re-derive. A posting opened here drills like it does on the Outbox.
 *
 * Docked, the drawer is published to the accounting layout's outlet: a docked
 * `DockableDrawer` with no portal target renders its children inline, which puts
 * the panel in the middle of the statement.
 */
export function PostingDrawerHost({ postingId, onClose }: PostingDrawerHostProps) {
  const period = useLedgerPeriod()
  const provider = useAccountingProviderStatus()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const router = useRouter()

  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const { currencyCode, bookTimeZone, resolvedPeriodKey } = period

  const drawer = useMemo(
    () => (
      <LedgerDrawerHost
        baseFrame={postingId ? toFrame('posting', postingId) : null}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        periodKey={resolvedPeriodKey ?? ''}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
        providerLabel={providerLabel}
        onOpenOutbox={(tab) => router.push(outboxHref(tab))}
      />
    ),
    [
      postingId,
      onClose,
      isDocked,
      dockedWidth,
      setDockedWidth,
      resolvedPeriodKey,
      currencyCode,
      bookTimeZone,
      providerLabel,
      router,
    ]
  )

  /**
   * ⚠️ `overlay: true` unconditionally. The panel only DOCKS when there is a
   * posting, but the overlay node stays mounted either way so `DockableDrawer`
   * can animate itself shut on its own `open` - unmounting it the moment the id
   * clears would cut that exit short.
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
