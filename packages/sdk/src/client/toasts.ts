// packages/sdk/src/client/toasts.ts

/**
 * Options for displaying a toast notification
 */
export interface ToastOptions {
  /** The toast message */
  message: string
  /** The variant/severity of the toast */
  variant?: 'info' | 'warning' | 'error' | 'success'
  /** Duration in milliseconds before the toast auto-dismisses */
  duration?: number
}

/**
 * Shows a toast notification to the user.
 *
 * @example
 * ```typescript
 * import { showToast } from '@auxx/sdk/client'
 *
 * showToast({
 *   message: 'Settings saved successfully',
 *   variant: 'success',
 *   duration: 3000
 * })
 * ```
 */
export function showToast(options: ToastOptions): void {
  if (typeof window !== 'undefined') {
    const sdk = (window as any).AUXX_CLIENT_EXTENSION_SDK
    if (sdk && typeof sdk.showToast === 'function') {
      return sdk.showToast(options)
    }
  }

  console.warn('[auxx/client] showToast called without runtime injection')
  console.warn('[auxx/client] Toast:', options.message)
}
