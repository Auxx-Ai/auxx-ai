// apps/web/src/components/global/forms/form-save-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { AnimatePresence, motion } from 'motion/react'

/** A touch past critical so the bar springs up with a slight overshoot (matches ConnectorSaveBar). */
const SPRING = { type: 'spring', stiffness: 420, damping: 26 } as const

export interface FormSaveBarProps {
  /** Draft diverges from the server value — show the bar and enable Save. */
  dirty: boolean
  /** A save is in flight — keep the bar up with a loading Save button. */
  isSaving: boolean
  onSave: () => void
  onDiscard: () => void
  /** Left-aligned status text. */
  label?: string
  /** Dirty-but-invalid → Save is visible-but-disabled (e.g. an invalid weekly draft). */
  saveDisabled?: boolean
}

/**
 * The shared unsaved-changes bar (10-settings-forms-unification.md) — a sticky, full-width bottom
 * bar that springs into view while a {@link useDirtyDraft} is dirty (or a save is in flight) and
 * springs away when clean. Replaces the five hand-rolled Save/Discard idioms across the money and
 * dispatch settings surfaces.
 */
export function FormSaveBar({
  dirty,
  isSaving,
  onSave,
  onDiscard,
  label = 'Unsaved changes',
  saveDisabled = false,
}: FormSaveBarProps) {
  return (
    <AnimatePresence>
      {(dirty || isSaving) && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={SPRING}
          className='sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur'>
          <span className='mr-auto text-xs text-muted-foreground'>{label}</span>
          <Button type='button' variant='outline' size='sm' onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button
            type='button'
            size='sm'
            onClick={onSave}
            loading={isSaving}
            loadingText='Saving...'
            disabled={saveDisabled}>
            Save
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
