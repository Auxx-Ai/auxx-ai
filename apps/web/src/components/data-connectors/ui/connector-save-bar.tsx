// apps/web/src/components/data-connectors/ui/connector-save-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { AnimatePresence, motion } from 'motion/react'
import { useConnectorEdits } from '../hooks/use-connector-edits'

/** A touch past critical so the button springs up with a slight overshoot. */
const SPRING = { type: 'spring', stiffness: 420, damping: 26 } as const

/**
 * The single, universal save control for the connector root panel — a floating
 * button pinned to the bottom of the panel that springs up from nothing when some
 * wrapped section (source config, schedule) is dirty and springs back down when it
 * isn't. Overlays the scroll content (doesn't take layout), and commits every
 * dirty section at once. Replaces the per-section Save buttons.
 */
export function ConnectorSaveBar() {
  const { isDirty, isSaving, commitAll } = useConnectorEdits()

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-end px-5 pb-4'>
      <AnimatePresence>
        {isDirty && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={SPRING}
            className='pointer-events-auto'>
            <Button
              size='sm'
              className='shadow-lg'
              loading={isSaving}
              loadingText='Saving...'
              onClick={() => void commitAll()}>
              Save changes
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
