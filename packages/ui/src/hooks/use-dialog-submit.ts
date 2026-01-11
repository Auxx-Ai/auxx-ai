// packages/ui/src/hooks/use-dialog-submit.ts
'use client'

import * as React from 'react'
import { DialogContext } from '../components/dialog'

interface UseDialogSubmitOptions {
  /** The submit handler - can be a form handleSubmit or a simple function */
  onSubmit: (() => void) | ((e?: React.BaseSyntheticEvent) => Promise<void>)
  /** Whether submit is disabled (e.g., while loading) */
  disabled?: boolean
}

interface UseDialogSubmitReturn {
  /** Props to spread on a form element */
  formProps: { onSubmit: (e: React.FormEvent) => void }
}

/**
 * Hook to register a dialog submit handler for Meta+Enter keyboard shortcut.
 * Works inside DialogContent - the submit handler is triggered when
 * user presses Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux).
 *
 * @example
 * // Pattern A: With React Hook Form
 * const { formProps } = useDialogSubmit({
 *   onSubmit: form.handleSubmit(onSubmit),
 *   disabled: isPending,
 * })
 * <form {...formProps}>...</form>
 *
 * @example
 * // Pattern B: No form (onClick)
 * useDialogSubmit({
 *   onSubmit: handleSave,
 *   disabled: isSaving,
 * })
 * <Button onClick={handleSave}>Save</Button>
 */
export function useDialogSubmit(options: UseDialogSubmitOptions): UseDialogSubmitReturn {
  const { onSubmit, disabled = false } = options
  const { submitHandlerRef, disabledRef } = React.useContext(DialogContext)

  // Keep refs in sync with current values
  React.useEffect(() => {
    submitHandlerRef.current = () => {
      // Call with undefined to simulate form submit without event
      onSubmit()
    }
    disabledRef.current = disabled

    return () => {
      submitHandlerRef.current = null
      disabledRef.current = false
    }
  }, [onSubmit, disabled, submitHandlerRef, disabledRef])

  // Form props for form-based usage
  const formProps = React.useMemo(
    () => ({
      onSubmit: (e: React.FormEvent) => {
        e.preventDefault()
        if (!disabled) {
          onSubmit()
        }
      },
    }),
    [onSubmit, disabled]
  )

  return { formProps }
}
