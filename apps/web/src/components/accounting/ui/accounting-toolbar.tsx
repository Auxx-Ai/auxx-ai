// apps/web/src/components/accounting/ui/accounting-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useAccountingToolbarOutlet } from '~/components/accounting/accounting-toolbar-outlet'
import { PostingGuideDialog } from '~/components/accounting/ui/settings/posting-guide-dialog'
import { SecondarySidebarTrigger } from '~/components/global/secondary-sidebar-provider'
import { Tooltip } from '~/components/global/tooltip'

/**
 * The module's one topbar (`gap-1 p-1`, ghost `h-7` buttons, `Separator`
 * dividers, tooltips) — the scale the ledger's own bar set before it became
 * `LedgerPeriodControls`.
 *
 * ```
 * [ ▤ ]  │  {left} ───────────────── {right}  │  [ ? ]
 * ```
 *
 * ⚠️ The rail toggle, both separators and the help button render
 * UNCONDITIONALLY. A page's controls land one commit after the route, so a bar
 * that sized itself from them would grow on the second frame and shift
 * everything below it (81-one-accounting-shell.md §7).
 */
export function AccountingToolbar() {
  const { left, right } = useAccountingToolbarOutlet()
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <div className='flex shrink-0 flex-wrap items-center gap-1 border-b p-1'>
      <SecondarySidebarTrigger />

      <Separator orientation='vertical' className='hidden h-6 md:block' />

      {left}

      <div className='flex-1' />

      {right}

      <Separator orientation='vertical' className='h-6' />

      {/* The posting guide's overview (brief 28 §4): what posts, when, and what
          changes it. Last, like the records guide on the table toolbar. */}
      <Tooltip content='How your books post'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='How your books post'
          onClick={() => setGuideOpen(true)}>
          <CircleHelp />
        </Button>
      </Tooltip>
      {guideOpen && (
        <PostingGuideDialog open={guideOpen} onOpenChange={setGuideOpen} initialPage='overview' />
      )}
    </div>
  )
}

/**
 * A route's name in the topbar's `left`, for a page with no period control to
 * put there. `hint` is the scope the name alone does not carry.
 */
export function ToolbarTitle({
  children,
  hint,
  count,
}: {
  children: ReactNode
  hint?: string
  count?: number
}) {
  return (
    <span className='flex items-center gap-2 px-1 font-medium text-sm'>
      {children}
      {hint && <span className='font-normal text-muted-foreground text-xs'>{hint}</span>}
      {count !== undefined && count > 0 && (
        <span className='font-normal text-muted-foreground text-xs tabular-nums'>{count}</span>
      )}
    </span>
  )
}
