// packages/sdk/src/client/navigation.ts

/**
 * Navigates to a path within the Auxx application.
 *
 * @param path - The path to navigate to (e.g., '/tickets', '/settings')
 *
 * @example
 * ```typescript
 * import { navigateTo } from '@auxx/sdk/client'
 *
 * navigateTo('/tickets/123')
 * ```
 */
export function navigateTo(path: string): void {
  if (typeof window !== 'undefined') {
    const sdk = (window as any).AUXX_CLIENT_EXTENSION_SDK
    if (sdk && typeof sdk.navigateTo === 'function') {
      return sdk.navigateTo(path)
    }
  }

  console.warn('[auxx/client] navigateTo called without runtime injection')
  console.warn('[auxx/client] Would navigate to:', path)
}

/**
 * Opens a record in the Auxx application.
 *
 * @param recordId - The ID of the record to open
 *
 * @example
 * ```typescript
 * import { openRecord } from '@auxx/sdk/client'
 *
 * openRecord('rec_123456')
 * ```
 */
export function openRecord(recordId: string): void {
  if (typeof window !== 'undefined') {
    const sdk = (window as any).AUXX_CLIENT_EXTENSION_SDK
    if (sdk && typeof sdk.openRecord === 'function') {
      return sdk.openRecord(recordId)
    }
  }

  console.warn('[auxx/client] openRecord called without runtime injection')
  console.warn('[auxx/client] Would open record:', recordId)
}

/**
 * Opens a URL in the browser.
 *
 * @param url - The URL to open
 * @param newTab - Whether to open in a new tab (default: false)
 *
 * @example
 * ```typescript
 * import { openUrl } from '@auxx/sdk/client'
 *
 * openUrl('https://example.com', true)
 * ```
 */
export function openUrl(url: string, newTab = false): void {
  if (typeof window !== 'undefined') {
    const sdk = (window as any).AUXX_CLIENT_EXTENSION_SDK
    if (sdk && typeof sdk.openUrl === 'function') {
      return sdk.openUrl(url, newTab)
    }
  }

  console.warn('[auxx/client] openUrl called without runtime injection')
  console.warn('[auxx/client] Would open URL:', url, 'newTab:', newTab)
}
