// apps/web/src/components/kopilot/ui/kopilot-dock.tsx

'use client'

import { PanelFrame } from '@auxx/ui/components/panel-frame'
import { PanelResizeHandle } from '@auxx/ui/components/panel-resize-handle'
import { useHotkey } from '@tanstack/react-hotkeys'
import { AnimatePresence, motion } from 'motion/react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useIsMobile } from '~/hooks/use-mobile'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useKopilotStore } from '../stores/kopilot-store'
import { useMergedKopilotContext } from '../stores/select-context'
import { KopilotPanel } from './kopilot-panel'

/**
 * Global Kopilot dock rendered at the Dashboard level, outside of any page's
 * MainPageContent. This keeps Kopilot available on every /app/* route without
 * each page needing to wire up its own panel config.
 */
export function KopilotDock() {
  const { hasAccess } = useFeatureFlags()
  const kopilotEnabled = hasAccess('kopilot')
  const pathname = usePathname()
  const isOnKopilotPage = pathname.startsWith('/app/kopilot')

  const panelOpen = useKopilotStore((s) => s.panelOpen)
  const togglePanel = useKopilotStore((s) => s.togglePanel)
  const panelWidth = useKopilotStore((s) => s.panelWidth)
  const setPanelWidth = useKopilotStore((s) => s.setPanelWidth)
  const context = useMergedKopilotContext()

  const [isResizing, setIsResizing] = useState(false)
  const isMobile = useIsMobile()

  // Global keyboard shortcut — registered once here
  useHotkey('mod+shift+k', () => togglePanel(), {
    enabled: kopilotEnabled,
    conflictBehavior: 'allow',
  })

  if (!kopilotEnabled || isOnKopilotPage) return null

  if (isMobile) {
    return (
      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.div
            className='fixed inset-0 z-50 bg-background'
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ duration: 0.2, ease: [0.165, 0.84, 0.44, 1] }}>
            <KopilotPanel page={context.page ?? 'unknown'} />
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence initial={false}>
      {panelOpen && (
        <motion.div
          className='flex flex-row shrink-0  bg-neutral-100 dark:bg-background -ml-3 z-1'
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: panelWidth + 20, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={
            isResizing ? { duration: 0 } : { duration: 0.2, ease: [0.165, 0.84, 0.44, 1] }
          }>
          <PanelResizeHandle
            currentWidth={panelWidth}
            onWidthChange={setPanelWidth}
            minWidth={360}
            maxWidth={600}
            onResizeStart={() => setIsResizing(true)}
            onResizeEnd={() => setIsResizing(false)}
          />
          <div className='pb-3 pr-3 pt-1.5'>
            <PanelFrame width={panelWidth}>
              <KopilotPanel page={context.page ?? 'unknown'} />
            </PanelFrame>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
