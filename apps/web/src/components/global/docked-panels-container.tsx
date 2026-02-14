// apps/web/src/components/global/docked-panels-container.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Columns2, Layers, Play, Settings } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { type DockPanelType, usePanelStore } from '~/components/workflow/store/panel-store'
import { useMedia } from '~/hooks/use-media'
import { type DockLayoutMode, useDockStore } from '~/stores/dock-store'
import { DockedPanelTarget } from './dock-portal-provider'

interface DockedPanelsContainerProps {
  /** Fallback content when no panels are open */
  fallback?: React.ReactNode
}

/**
 * Container for docked panels that supports:
 * - Single panel mode (no tabs, full panel)
 * - Side-by-side mode (two PanelFrames next to each other - handled by parent)
 * - Tabbed mode (single PanelFrame with tabs)
 *
 * This component is used inside a single PanelFrame container and handles
 * the tabbed UI when multiple panels are open.
 */
export function DockedPanelsContainer({ fallback }: DockedPanelsContainerProps) {
  const panelStack = usePanelStore((state) => state.panelStack)
  const activeDockTab = usePanelStore((state) => state.activeDockTab)
  const setActiveDockTab = usePanelStore((state) => state.setActiveDockTab)

  const layoutMode = useDockStore((state) => state.layoutMode)
  const setLayoutMode = useDockStore((state) => state.setLayoutMode)
  const autoBreakpoint = useDockStore((state) => state.autoBreakpoint)

  // Use media query to detect wide screen
  const isWideScreen = useMedia(`(min-width: ${autoBreakpoint}px)`)

  const panelCount = panelStack.length
  const hasPropertyPanel = panelStack.includes('property')
  const hasRunPanel = panelStack.includes('run')
  const hasSettingsPanel = panelStack.includes('settings')

  // Determine effective layout mode
  const effectiveLayout = (() => {
    if (panelCount <= 1) return 'single'
    if (layoutMode === 'tabbed') return 'tabbed'
    if (layoutMode === 'side-by-side') return 'side-by-side'
    // Auto mode: use side-by-side on wide screens
    return isWideScreen ? 'side-by-side' : 'tabbed'
  })()

  // No panels open - show fallback
  if (panelCount === 0) {
    return <>{fallback}</>
  }

  // Single panel mode - just the portal target (no tabs needed)
  if (effectiveLayout === 'single') {
    return <DockedPanelTarget slot='primary' />
  }

  // Side-by-side mode is handled at the page level, not here.
  // This container is only used for single/tabbed mode.
  // If we're in side-by-side mode but got here, it means the page
  // is rendering separate PanelFrames so we just show primary target.
  if (effectiveLayout === 'side-by-side') {
    return <DockedPanelTarget slot='primary' />
  }

  // Tabbed mode - single container with tabs inside
  return (
    <div className='flex flex-col h-full'>
      {/* Tab header */}
      <div className='flex items-center justify-between border-b px-2 py-1 shrink-0 bg-secondary/30'>
        <Tabs value={activeDockTab} onValueChange={(v) => setActiveDockTab(v as DockPanelType)}>
          <TabsList className='h-7 gap-0.5 bg-transparent'>
            {hasPropertyPanel && (
              <TabsTrigger
                value='property'
                className='h-6 text-xs px-2 data-[state=active]:bg-background'>
                <Settings className='size-3 mr-1' />
                Properties
              </TabsTrigger>
            )}
            {hasSettingsPanel && (
              <TabsTrigger
                value='settings'
                className='h-6 text-xs px-2 data-[state=active]:bg-background'>
                <Settings className='size-3 mr-1' />
                Settings
              </TabsTrigger>
            )}
            {hasRunPanel && (
              <TabsTrigger
                value='run'
                className='h-6 text-xs px-2 data-[state=active]:bg-background'>
                <Play className='size-3 mr-1' />
                Run
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <LayoutToggle currentLayout={effectiveLayout} onLayoutChange={setLayoutMode} />
      </div>
      {/* Tab content - portal target with filter */}
      <div className='flex-1 overflow-hidden'>
        <DockedPanelTarget slot='primary' panelFilter={activeDockTab} />
      </div>
    </div>
  )
}

/**
 * Toggle button to switch between tabbed and side-by-side layouts.
 */
function LayoutToggle({
  currentLayout,
  onLayoutChange,
}: {
  currentLayout: string
  onLayoutChange: (mode: DockLayoutMode) => void
}) {
  const isTabbed = currentLayout === 'tabbed'

  return (
    <Tooltip content={isTabbed ? 'Split panels side by side' : 'Stack panels in tabs'}>
      <Button
        variant='ghost'
        size='icon-xs'
        className='h-6 w-6 shrink-0'
        onClick={() => onLayoutChange(isTabbed ? 'side-by-side' : 'tabbed')}>
        {isTabbed ? <Columns2 className='size-3.5' /> : <Layers className='size-3.5' />}
      </Button>
    </Tooltip>
  )
}
