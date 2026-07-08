// apps/web/src/components/versioning/ui/publish-cluster-shell.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, Send, Undo2 } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'

export interface PublishClusterShellProps {
  status: { isPublished: boolean; hasUnsaved: boolean; isArchived?: boolean }
  /** Optional tooltip on the status pill (presentation only — e.g. what "Live" means). */
  pillTooltip?: string
  /**
   * Repurpose the status pill as an action button (e.g. a live/draft view toggle):
   * overrides its label, dot colour, click handler, and tooltip. When set, clicking
   * the pill no longer opens the menu — the chevron still does. Segment visibility
   * (publish/discard) is unaffected; it stays driven by `status`.
   */
  pillOverride?: {
    label: string
    dotClassName: string
    onClick: () => void
    tooltip?: string
  }
  /**
   * Hide the status pill entirely (e.g. while editing, when a separate autosave
   * indicator already conveys status). The chevron menu still renders, so the
   * dropdown stays reachable.
   */
  hidePill?: boolean
  publish?: {
    onClick: () => void
    isPending?: boolean
    /** Default 'Publish'. */
    label?: string
    /** Renders the publish button disabled, wrapped in a tooltip with this reason. */
    disabledReason?: string
  }
  discard?: { onClick: () => void; isPending?: boolean }
  /** Extra inline segments rendered before the publish segment (e.g. a diff button). */
  extraSegments?: React.ReactNode
  /** Dropdown menu content (DropdownMenuItem children). */
  children: React.ReactNode
}

/**
 * Shared publish-cluster shell — the pill, the ButtonGroup/separator layout, and
 * the chevron menu, owned in one place for agents, procedures, and articles.
 *
 * Hard rule: **slots, not behavior flags.** The shell never learns entity kinds
 * or what "unpublish" means — consumers own every handler, confirm, and menu
 * item. It owns only: the four-state pill (red Archived / amber Live·unsaved /
 * emerald Live / slate Draft), segment visibility (publish when
 * `!isPublished || hasUnsaved`, discard when `isPublished && hasUnsaved`), the
 * `border-r-0` + separator dance, button loading states, and the menu trigger.
 * See plans/agents/agent-versions/ui-plan.md §1.2.
 */
export function PublishClusterShell({
  status,
  pillTooltip,
  pillOverride,
  hidePill,
  publish,
  discard,
  extraSegments,
  children,
}: PublishClusterShellProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const { isPublished, hasUnsaved, isArchived } = status
  const derivedDotClass = isArchived
    ? 'bg-red-500'
    : isPublished
      ? hasUnsaved
        ? 'bg-amber-500'
        : 'bg-emerald-500'
      : 'bg-slate-400'
  const derivedLabel = isArchived ? 'Archived' : isPublished ? 'Live' : 'Draft'

  const dotClass = pillOverride?.dotClassName ?? derivedDotClass
  const pillLabel = pillOverride?.label ?? derivedLabel
  const pillTooltipText = pillOverride?.tooltip ?? pillTooltip
  const onPillClick = pillOverride?.onClick ?? (() => setIsMenuOpen((prev) => !prev))

  const showPublish = !!publish && (!isPublished || hasUnsaved)
  const showDiscard = !!discard && isPublished && hasUnsaved
  const publishLabel = publish?.label ?? 'Publish'

  const pillButton = (
    <Button size='xs' variant='outline' className='gap-2 border-r-0' onClick={onPillClick}>
      <span className={cn('inline-block size-2 rounded-full', dotClass)} />
      {pillLabel}
    </Button>
  )

  return (
    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <ButtonGroup className='shrink-0'>
        {!hidePill &&
          (pillTooltipText ? (
            <Tooltip>
              <TooltipTrigger asChild>{pillButton}</TooltipTrigger>
              <TooltipContent>{pillTooltipText}</TooltipContent>
            </Tooltip>
          ) : (
            pillButton
          ))}

        {extraSegments ? (
          <>
            {/* No leading separator when the pill is hidden — extraSegments start the group. */}
            {!hidePill && <ButtonGroupSeparator />}
            {extraSegments}
          </>
        ) : null}

        {showPublish && publish ? (
          <>
            <ButtonGroupSeparator />
            {publish.disabledReason ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='inline-flex'>
                    <Button
                      size='xs'
                      variant='outline'
                      className='rounded-none border-x-0'
                      disabled>
                      <Send /> {publishLabel}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{publish.disabledReason}</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                size='xs'
                variant='outline'
                className='border-r-0'
                loading={publish.isPending}
                loadingText='Publishing…'
                onClick={publish.onClick}>
                <Send /> {publishLabel}
              </Button>
            )}
          </>
        ) : null}

        {showDiscard && discard ? (
          <>
            <ButtonGroupSeparator />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='xs'
                  variant='outline'
                  className='border-r-0 px-1.5'
                  loading={discard.isPending}
                  loadingText=''
                  onClick={discard.onClick}
                  aria-label='Discard changes'>
                  <Undo2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard changes</TooltipContent>
            </Tooltip>
          </>
        ) : null}

        <ButtonGroupSeparator />
        <DropdownMenuTrigger asChild>
          <Button size='xs' variant='outline' className='px-1.5' aria-label='Publish menu'>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
      </ButtonGroup>

      <DropdownMenuContent align='end' className='w-56'>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
