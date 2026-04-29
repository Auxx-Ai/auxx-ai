// packages/ui/src/components/kb/layout/kb-sidebar-mobile-trigger.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Menu } from 'lucide-react'
import { useKBLayoutContext } from './kb-layout-context'

interface KBSidebarMobileTriggerProps {
  className?: string
}

export function KBSidebarMobileTrigger({ className }: KBSidebarMobileTriggerProps) {
  const { setMobileOpen } = useKBLayoutContext()
  return (
    <button
      type='button'
      onClick={() => setMobileOpen(true)}
      aria-label='Open menu'
      className={cn(
        'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--kb-radius)] border-0 bg-transparent text-[var(--kb-fg)] transition-colors hover:bg-[var(--kb-muted)] @kb-md:hidden',
        className
      )}>
      <Menu className='size-5' />
    </button>
  )
}
