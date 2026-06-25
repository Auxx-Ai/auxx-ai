// apps/web/src/components/data-connectors/ui/connector-save-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Loader2 } from 'lucide-react'
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
 *
 * In auto-save mode (setup) there's no manual commit — drafts persist on a debounce —
 * so the bar degrades to a passive "Saving…" pill shown only while a save is in flight.
 */
export function ConnectorSaveBar() {
  const { isDirty, isSaving, autoSave, commitAll } = useConnectorEdits()

  // Setup mode: no button, just transient save feedback.
  if (autoSave) {
    return (
      <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-end px-5 pb-4'>
        <AnimatePresence>
          {isSaving && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={SPRING}
              className='flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-lg'>
              <Loader2 className='size-3.5 animate-spin' />
              Saving…
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

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
