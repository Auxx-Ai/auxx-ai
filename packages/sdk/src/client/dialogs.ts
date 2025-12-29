// packages/sdk/src/client/dialogs.ts

import { SURFACES } from '../runtime/index.js'
import { Host } from '../runtime/host.js'
import type { DialogComponent } from './types.js'

const DIALOG_PREFIX = 'DIALOG'
let dialogIdCounter = 0

/**
 * Map to store dialog callbacks
 * Callbacks are stored here because functions cannot be serialized via postMessage.
 */
const dialogCallbackMap = new Map<
  string,
  {
    onClose: () => void
  }
>()

/**
 * Listen for platform requesting dialog close.
 * This is called when the user clicks the close button in the platform UI.
 */
Host.onRequest('dialog-close-requested', async ({ id }: { id: string }) => {
  console.log('[Dialogs] Platform requested close for dialog:', id)

  const callbacks = dialogCallbackMap.get(id)
  if (callbacks) {
    callbacks.onClose()
    dialogCallbackMap.delete(id)
  }

  return null
})

/**
 * Options for displaying a dialog to the user.
 *
 * IMPORTANT: The Dialog component can ONLY use approved SDK components.
 * Raw HTML elements (div, p, button, etc.) are NOT allowed.
 * This ensures consistent design and prevents security issues.
 */
export interface DialogOptions {
  /** The title of the dialog */
  title: string

  /**
   * The Dialog component to render.
   *
   * MUST only use SDK components (TextBlock, Button, Badge, etc.)
   * Cannot use raw HTML elements (div, p, button, etc.)
   */
  Dialog: DialogComponent

  /** The size of the dialog */
  size?: 'small' | 'medium' | 'large' | 'fullscreen'
}

/**
 * Shows a dialog to the user.
 *
 * 1. Create the dialog element
 * 2. Store it in SURFACES (stays in iframe!)
 * 3. Store callback in map
 * 4. Tell platform "dialog opened" (send metadata only)
 * 5. Platform requests render
 * 6. Runtime reconciles and returns sanitized tree
 * 7. Platform displays dialog
 * 8. User closes → Platform notifies runtime → Callback fires → Promise resolves
 *
 * Only one dialog can be open at a time.
 *
 * IMPORTANT: Dialog content must ONLY use approved SDK components.
 * Using raw HTML elements will cause TypeScript errors.
 *
 * @example
 * ```typescript
 * import { showDialog, TextBlock, Button } from '@auxx/sdk/client'
 *
 * // ✅ CORRECT - Uses SDK components
 * await showDialog({
 *   title: 'Hello',
 *   Dialog: ({ hideDialog }) => (
 *     <>
 *       <TextBlock>World</TextBlock>
 *       <Button label="Close" onClick={hideDialog} />
 *     </>
 *   )
 * })
 * ```
 */
export async function showDialog(options: DialogOptions): Promise<void> {
  console.log('[showDialog] CALLED with options:', options)

  // Check if SURFACES is available (runtime environment)
  if (typeof SURFACES === 'undefined') {
    console.warn('[@auxx/sdk/client] showDialog called without runtime. Dialog:', options.title)
    return
  }

  // Enforce single dialog rule
  const hasOpenDialog = SURFACES.renderedComponentIds.some((id) => id.startsWith(DIALOG_PREFIX))

  if (hasOpenDialog) {
    throw new Error('Only one dialog can be open at a time')
  }

  return new Promise<void>((resolve) => {
    const dialogId = `${DIALOG_PREFIX}_${++dialogIdCounter}`
    const { title, Dialog, size = 'medium' } = options

    // Get React from window
    const React = (window as any).React
    if (!React) {
      throw new Error('React not available in window')
    }

    console.log('[showDialog] Creating dialog element (stays in iframe)')

    // Create dialog element
    // This element STAYS IN THE IFRAME - it's not sent via postMessage!
    const dialogElement = React.createElement(
      'auxxdialog',
      {
        component: 'Dialog',
        title,
        size,
        dialogId,
      },
      React.createElement(
        React.Suspense,
        { fallback: React.createElement('div', null, 'Loading...') },
        React.createElement(Dialog, {
          hideDialog: () => {
            // This function stays in the iframe!
            // When called, tell platform to close the dialog
            console.log('[showDialog] hideDialog called, notifying platform')
            Host.sendMessage('close-dialog', { id: dialogId })
          },
        })
      )
    )

    // Store component in SURFACES (stays in iframe!)
    console.log('[showDialog] Storing component in SURFACES')
    SURFACES.renderComponent(dialogId, dialogElement)

    // Store callback in map
    console.log('[showDialog] Storing callback in dialogCallbackMap')
    dialogCallbackMap.set(dialogId, {
      onClose: () => {
        console.log('[showDialog] onClose callback called')
        SURFACES.unrenderComponent(dialogId)
        resolve() // Resolve the promise
      },
    })

    // Tell platform to show dialog shell (send metadata only, not component!)
    console.log('[showDialog] Notifying platform: dialog-opened')
    Host.sendMessage('dialog-opened', {
      id: dialogId,
      title,
      size,
      // NO component! Platform will request it via 'render-component'
    })
  })
}

/**
 * Closes the currently open dialog.
 */
export async function closeDialog(): Promise<void> {
  if (typeof SURFACES === 'undefined') {
    console.warn('[@auxx/sdk/client] closeDialog called without runtime')
    return
  }

  // Find the dialog
  const dialogId = SURFACES.renderedComponentIds.find((id) => id.startsWith(DIALOG_PREFIX))

  if (dialogId) {
    // Tell platform to close it
    Host.sendMessage('close-dialog', { id: dialogId })
  }
}
