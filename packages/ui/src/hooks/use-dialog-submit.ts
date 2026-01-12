// packages/ui/src/hooks/use-dialog-submit.ts
'use client'

import * as React from 'react'

interface UseDialogSubmitOptions {
  /** The submit handler - can be a form handleSubmit or a simple function */
  onSubmit: (() => void) | ((e?: React.BaseSyntheticEvent) => Promise<void>)
  /** Whether submit is disabled (e.g., while loading) - no longer used, set disabled on button instead */
  disabled?: boolean
}

interface UseDialogSubmitReturn {
  /** Props to spread on a form element */
  formProps: {
    onSubmit: (e: React.FormEvent) => void
  }
}

/**
 * @deprecated This hook is no longer needed. DialogContent automatically handles
 * Meta+Enter for forms with a submit button using DOM-based detection.
 *
 * Migration:
 * - For forms: Just use `<form onSubmit={form.handleSubmit(onSubmit)}>` with
 *   `<Button type="submit" disabled={isPending}>`. The disabled state is now
 *   detected from the button's disabled attribute.
 * - For non-form dialogs: Add `data-dialog-submit` to the primary action button.
 *
 * This hook is kept for backwards compatibility and returns formProps for forms.
 */
export function useDialogSubmit(options: UseDialogSubmitOptions): UseDialogSubmitReturn {
  const { onSubmit, disabled = false } = options

  // Form props for backwards compatibility
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
