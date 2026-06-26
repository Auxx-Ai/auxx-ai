// apps/web/src/components/data-connectors/ui/connector-save-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useConnectorCommit } from '../hooks/use-connector-commit'
import {
  selectCanCommit,
  selectIsDirty,
  useConnectorDraftStore,
} from '../stores/connector-draft-store'

/** A touch past critical so the button springs up with a slight overshoot. */
const SPRING = { type: 'spring', stiffness: 420, damping: 26 } as const

/**
 * The single, universal save control for the connector editor — a floating button
 * pinned to the bottom of the panel that springs up when the draft is dirty (any
 * section: source, schedule, request, webhook steering, mappings) and springs back
 * when it isn't. It commits the WHOLE draft at once (`commit()` — the unified saving
 * model, plans/data-connectors/v4). Reads the draft store's `isDirty`/`canCommit`/
 * `isSaving` selectors directly — no section registry.
 *
 * In auto-save mode (setup) there's no manual commit — the draft flushes on a debounce
 * — so the bar degrades to a passive "Saving…" pill shown only while a save is in flight.
 */
export function ConnectorSaveBar() {
  const isDirty = useConnectorDraftStore(selectIsDirty)
  const canCommit = useConnectorDraftStore(selectCanCommit)
  const isSaving = useConnectorDraftStore((s) => s.isSaving)
  const autoSave = useConnectorDraftStore((s) => s.autoSave)
  const commit = useConnectorCommit()

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
              // Dirty but invalid (e.g. unparseable request body) → visible-but-disabled.
              disabled={!canCommit}
              onClick={() => void commit()}>
              Save changes
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
