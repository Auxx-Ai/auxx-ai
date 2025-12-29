// packages/sdk/src/client/alerts.ts

/**
 * Options for displaying an alert to the user
 */
export interface AlertOptions {
  /** The title of the alert */
  title: string
  /** The alert message */
  message: string
  /** The variant/severity of the alert */
  variant?: 'info' | 'warning' | 'error' | 'success'
}

/**
 * Options for displaying a confirmation dialog
 */
export interface ConfirmOptions {
  /** The title of the confirmation dialog */
  title: string
  /** The confirmation message */
  message: string
  /** Text for the confirm button */
  confirmText?: string
  /** Text for the cancel button */
  cancelText?: string
  /** Whether this is a destructive action */
  destructive?: boolean
}

/**
 * Shows an alert dialog to the user.
 *
 * @example
 * ```typescript
 * import { alert } from '@auxx/sdk/client'
 *
 * await alert({
 *   title: 'Success',
 *   message: 'Your changes have been saved',
 *   variant: 'success'
 * })
 * ```
 */
export async function alert(options: AlertOptions): Promise<void> {
  if (typeof window !== 'undefined') {
    const sdk = (window as any).AUXX_CLIENT_EXTENSION_SDK
    if (sdk && typeof sdk.alert === 'function') {
      return sdk.alert(options)
    }
  }

  console.warn('[@auxx/sdk/client] alert called without runtime injection')
  console.warn('[@auxx/sdk/client] Alert:', options.title, options.message)
}

/**
 * Shows a confirmation dialog and returns the user's choice.
 *
 * @returns true if the user confirmed, false if they cancelled
 *
 * @example
 * ```typescript
 * import { confirm } from '@auxx/sdk/client'
 *
 * const confirmed = await confirm({
 *   title: 'Delete Item',
 *   message: 'Are you sure you want to delete this item?',
 *   destructive: true
 * })
 *
 * if (confirmed) {
 *   // Delete the item
 * }
 * ```
 */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  if (typeof window !== 'undefined') {
    const sdk = (window as any).AUXX_CLIENT_EXTENSION_SDK
    if (sdk && typeof sdk.confirm === 'function') {
      return sdk.confirm(options)
    }
  }

  console.warn('[@auxx/sdk/client] confirm called without runtime injection')
  console.warn('[@auxx/sdk/client] Confirm:', options.title, options.message)
  return false
}
