// apps/web/src/components/global/module-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useModuleToolbarOutlet } from '~/components/global/module-toolbar-outlet'
import { SecondarySidebarTrigger } from '~/components/global/secondary-sidebar-provider'
import { Tooltip } from '~/components/global/tooltip'

/** Placeholder for a cell that has no value, as opposed to a zero. */
export const EMPTY_CELL = '—'

/** What the toolbar hands its help dialog: the dialog is controlled by the bar's button. */
export interface ModuleToolbarHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ModuleToolbarProps {
  /** Tooltip and aria-label of the help button. */
  helpLabel: string
  /** Renders the module's guide; mounted only while open. Omitted, the button shows disabled. */
  helpDialog?: (props: ModuleToolbarHelpProps) => ReactNode
}

/**
 * A module's one topbar (`gap-1 p-1`, ghost `h-7` buttons, `Separator`
 * dividers, tooltips), fed by `useRegisterModuleToolbar`.
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
export function ModuleToolbar({ helpLabel, helpDialog }: ModuleToolbarProps) {
  const { left, right } = useModuleToolbarOutlet()
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <div className='flex shrink-0 flex-wrap items-center gap-1 border-b p-1'>
      <SecondarySidebarTrigger />

      <Separator orientation='vertical' className='hidden h-6 md:block' />

      {left}

      <div className='flex-1' />

      {right}

      <Separator orientation='vertical' className='h-6' />

      <Tooltip content={helpLabel}>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={helpLabel}
          disabled={!helpDialog}
          onClick={() => setGuideOpen(true)}>
          <CircleHelp />
        </Button>
      </Tooltip>
      {guideOpen && helpDialog?.({ open: guideOpen, onOpenChange: setGuideOpen })}
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
