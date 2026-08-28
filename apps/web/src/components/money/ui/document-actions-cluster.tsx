// apps/web/src/components/money/ui/document-actions-cluster.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { DetailSectionActions, DetailSectionTitleExtra } from '~/components/detail-view'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import { Tooltip } from '~/components/global/tooltip'

export interface DocumentActionsClusterProps {
  /**
   * Primary inline segment — the Send/Resend button. Omit to render the menu as a
   * standalone labeled "Actions" button (e.g. a terminal status where the document
   * can no longer be sent).
   */
  send?: {
    label: string
    onClick: () => void
    isPending?: boolean
    /**
     * When set, the Send button renders disabled inside an interactive tooltip
     * carrying this reason (e.g. "connect an email channel" + a settings link).
     */
    disabledReason?: ReactNode
  }
  /** aria-label for the chevron trigger. */
  menuLabel?: string
  /** `DropdownMenuItem` children — every secondary/lifecycle action. */
  children: ReactNode
}

/**
 * Shared money-document lifecycle cluster (quote + invoice) — a `ButtonGroup` with
 * the primary Send/Resend segment + a chevron `DropdownMenu` holding every
 * secondary/lifecycle action (Download PDF, Mark as sent, approve/decline/convert/
 * void, return-to-draft). Mirrors {@link PublishClusterShell}'s "slots, not
 * behavior" contract: the shell owns layout only; consumers own every handler,
 * confirm, and menu item.
 */
export function DocumentActionsCluster({
  send,
  menuLabel = 'Document actions',
  children,
}: DocumentActionsClusterProps) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <ButtonGroup className='shrink-0'>
        {send &&
          (send.disabledReason ? (
            <Tooltip allowInteraction contentComponent={send.disabledReason}>
              {/*
                `rounded-r-none` is explicit here and NOT on the enabled branch below,
                which looks inconsistent and is not. `ButtonGroup` squares its inner
                corners with direct-child selectors (`[&>*:not(:last-child)]:rounded-r-none`),
                and a disabled button cannot receive the hover that opens a tooltip — so
                this branch needs the `<span>` wrapper, and that wrapper becomes the
                group's direct child. The selectors then style the span, which has no
                border or radius of its own, while the button inside keeps its full
                `rounded-lg` and bulges out of the right-hand seam. The enabled branch
                IS the direct child, so the group still reaches it.

                `publish-cluster-shell.tsx` carries the same `rounded-none border-x-0`
                on its own tooltip-wrapped disabled segment, for the same reason.
              */}
              <span className='inline-flex'>
                <Button size='xs' variant='outline' className='rounded-r-none border-r-0' disabled>
                  {send.label}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              size='xs'
              variant='outline'
              className='border-r-0'
              loading={send.isPending}
              loadingText='Preparing…'
              onClick={send.onClick}>
              {send.label}
            </Button>
          ))}

        {send && <ButtonGroupSeparator />}

        <DropdownMenuTrigger asChild>
          <Button
            size='xs'
            variant='outline'
            className={send ? 'px-1.5' : undefined}
            aria-label={menuLabel}>
            {!send && 'Actions'}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
      </ButtonGroup>

      <DropdownMenuContent align='end' className='w-52'>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Teleports a money-document's badge + action cluster into whichever `<Section>`
 * header is wrapping the tab: the detail-page sections layout (badge → title slot,
 * cluster → actions slot) or a drawer card (badge + cluster together in the single
 * actions slot). Every portal is a no-op when its slot is absent, so the two
 * surfaces coexist without the tab needing to know which one rendered it.
 */
export function DocumentSectionActions({
  badge,
  children,
}: {
  badge?: ReactNode
  /**
   * Optional: an `order` has a status badge but NO actions cluster — its two
   * status fields are plain human-set values with no sanctioned transition
   * behind them, unlike quote's Send/Approve and invoice's Send/Void
   * (plans/products/08-order-build.md §5.8).
   */
  children?: ReactNode
}) {
  return (
    <>
      {badge ? <DetailSectionTitleExtra>{badge}</DetailSectionTitleExtra> : null}
      <DetailSectionActions>{children}</DetailSectionActions>
      <DrawerCardActions>
        <div className='flex items-center gap-2'>
          {badge}
          {children}
        </div>
      </DrawerCardActions>
    </>
  )
}
