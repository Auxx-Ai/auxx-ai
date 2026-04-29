// packages/ui/src/components/kb/layout/kb-sidebar-toggle.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { PanelLeft } from 'lucide-react'
import { useKBLayoutContext } from './kb-layout-context'

interface KBSidebarToggleProps {
  className?: string
}

export function KBSidebarToggle({ className }: KBSidebarToggleProps) {
  const { collapsed, setCollapsed } = useKBLayoutContext()
  return (
    <button
      type='button'
      onClick={() => setCollapsed((v) => !v)}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cn(
        'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--kb-radius)] border-0 bg-transparent text-[var(--kb-fg)] transition-colors hover:bg-[var(--kb-muted)]',
        className
      )}>
      <PanelLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
    </button>
  )
}
