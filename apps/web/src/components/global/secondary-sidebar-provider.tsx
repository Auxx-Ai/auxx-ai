// apps/web/src/components/global/secondary-sidebar-provider.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { SidebarProvider, useSidebar } from '@auxx/ui/components/sidebar'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { PanelLeft } from 'lucide-react'
import type React from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

type SecondarySidebarPrefs = {
  open: boolean
  setOpen: (open: boolean) => void
  width: number | undefined
  setWidth: (width: number) => void
}

type SecondarySidebarState = { open: boolean; toggle: () => void }

const PrefsContext = createContext<SecondarySidebarPrefs | null>(null)
// Own context rather than `useSidebar()`, which throws outside a provider and would
// return the app-shell sidebar outside a section.
const StateContext = createContext<SecondarySidebarState | null>(null)

/**
 * Open/width shared by every `SidebarSecondary`. Lives in `Dashboard` because the section
 * layouts remount on navigation and would otherwise restart from the stale SSR cookie.
 */
export function SecondarySidebarPrefsProvider({
  defaultOpen = true,
  defaultWidth,
  children,
}: {
  defaultOpen?: boolean
  defaultWidth?: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [width, setWidth] = useState(defaultWidth)
  const value = useMemo(() => ({ open, setOpen, width, setWidth }), [open, width])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

/**
 * Nested sidebar context for one section's `SidebarSecondary` + content row, so a toggle in the
 * content can reach it. Renders the row itself (`flex h-full min-h-0` + `className`).
 */
export function SecondarySidebarProvider({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const prefs = useContext(PrefsContext)
  // Cookie name is mirrored in `app/(protected)/app/layout.tsx`, which reads it for SSR.
  return (
    <SidebarProvider
      nested
      resizable
      persistKey='secondary_sidebar'
      keyboardShortcut={false}
      open={prefs?.open}
      onOpenChange={prefs?.setOpen}
      initialWidth={prefs?.width}
      onWidthChange={prefs?.setWidth}
      className={className}>
      <StateBridge>{children}</StateBridge>
    </SidebarProvider>
  )
}

function StateBridge({ children }: { children: React.ReactNode }) {
  const { state, toggleSidebar } = useSidebar()
  const open = state === 'expanded'
  const value = useMemo(() => ({ open, toggle: toggleSidebar }), [open, toggleSidebar])
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>
}

/** True when rendered inside a `SecondarySidebarProvider` whose sidebar is collapsed. */
export function useSecondarySidebarCollapsed() {
  const state = useContext(StateContext)
  return state !== null && !state.open
}

/** Desktop show/hide button for the enclosing `SidebarSecondary`; renders nothing outside one. */
export function SecondarySidebarTrigger({ className }: { className?: string }) {
  const state = useContext(StateContext)
  if (!state) return null

  const { open, toggle } = state
  return (
    <SimpleTooltip content={open ? 'Hide sidebar' : 'Show sidebar'}>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label='Toggle sidebar'
        aria-expanded={open}
        className={cn('hidden md:inline-flex', className)}
        onClick={toggle}>
        <PanelLeft />
      </Button>
    </SimpleTooltip>
  )
}
