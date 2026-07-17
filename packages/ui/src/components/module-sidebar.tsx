// packages/ui/src/components/module-sidebar.tsx

'use client'

import { Sidebar, SidebarContent, SidebarProvider, useSidebar } from '@auxx/ui/components/sidebar'
import * as React from 'react'

interface ModuleSidebarProps {
  /**
   * Whether the sidebar is visible. The caller (the page) owns this — e.g. persisted in its
   * own store. Desktop show/hide is wired directly to the nested provider's `open` (the
   * non-fixed `Sidebar` animates its width to 0 when collapsed). Mobile show/hide goes
   * through the Sheet, which is driven by the provider's own `openMobile` — see
   * `ModuleSidebarMobileSync` below for how `open` bridges into it.
   */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Sidebar width. Defaults to `16rem` — fixed, not resizable, per the module sidebar design. */
  width?: string
  className?: string
  children: React.ReactNode
  /** Pinned below the scroll area (a real `SidebarFooter` home) — e.g. the dispatch board's
   * "Show canceled" toggle. Children scroll; this doesn't. */
  footer?: React.ReactNode
}

/**
 * Generic Notion-Calendar-style module sidebar shell, meant to sit under a toolbar as a flex
 * sibling of the page's main content (e.g. the dispatch board's calendar/map, later the
 * schedule page). Composes a `SidebarProvider` nested under the app-shell one:
 * - `persistKey={false}` — the caller persists `open` itself, skip the cookie write.
 * - `keyboardShortcut={false}` — don't fight the app-shell sidebar for Cmd/Ctrl+B.
 * - `nested` — participates in a flex row instead of owning the page (`flex h-full min-h-0`,
 *   no `min-h-svh`).
 *
 * ### The mobile open-state bridge
 *
 * The nested provider's `openMobile` (which drives the Sheet on small screens) is *internal*
 * state — `SidebarProvider` has no `openMobile`/`onOpenMobileChange` control props, only
 * `open`/`onOpenChange` for desktop. A toolbar toggle button typically lives OUTSIDE
 * `ModuleSidebar` (next to other toolbar controls), so it only ever has `open`/`onOpenChange`
 * to work with, not the nested provider's `useSidebar()` context.
 *
 * `ModuleSidebarMobileSync` (rendered inside the nested provider) mirrors `open` into
 * `openMobile` whenever `open` changes, so one toggle button drives both surfaces. This is a
 * **one-way** sync: dismissing the mobile Sheet locally (overlay tap / swipe / Escape) closes
 * it without clearing the caller's `open` state — the sync effect only depends on `open`
 * (not `openMobile`), so it won't fight the user's dismissal by reopening it. The next
 * explicit toggle resyncs both surfaces. A full two-way bridge isn't worth the complexity for
 * a single toggle button whose own state already reflects intent.
 */
function ModuleSidebar({
  open,
  onOpenChange,
  width = '16rem',
  className,
  children,
  footer,
}: ModuleSidebarProps) {
  return (
    <SidebarProvider
      persistKey={false}
      keyboardShortcut={false}
      nested
      open={open}
      onOpenChange={onOpenChange}
      width={width}>
      <ModuleSidebarMobileSync open={open} />
      <Sidebar fixed={false} collapsible='offcanvas' side='left' className={className}>
        <SidebarContent>{children}</SidebarContent>
        {footer}
      </Sidebar>
    </SidebarProvider>
  )
}

/** See the "mobile open-state bridge" section of `ModuleSidebar`'s JSDoc. Renders nothing. */
function ModuleSidebarMobileSync({ open }: { open: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar()

  // Deliberately not reading `openMobile` here — this should only push `open` -> `openMobile`
  // on changes to `open` itself, never fight a user-driven local Sheet dismissal.
  React.useEffect(() => {
    if (isMobile) setOpenMobile(open)
  }, [isMobile, open, setOpenMobile])

  return null
}

/** Alias of `useSidebar` scoped to the nested module sidebar's own context. */
const useModuleSidebar = useSidebar

export { ModuleSidebar, useModuleSidebar }
