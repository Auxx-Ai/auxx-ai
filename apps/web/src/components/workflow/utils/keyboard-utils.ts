// apps/web/src/components/workflow/utils/keyboard-utils.ts

/**
 * Utility functions for handling keyboard events in the workflow editor
 */

/**
 * Check if the user has actively selected text on the page
 * This prevents custom shortcuts from interfering with native browser text operations
 * @returns true if user has selected text, false otherwise
 */
export function hasActiveTextSelection(): boolean {
  const selection = window.getSelection()
  // Check if there's an actual selection with non-empty content
  return !!(selection && selection.rangeCount > 0 && selection.toString().trim().length > 0)
}

/**
 * Check if the user is currently typing in an input field
 * This prevents global keyboard shortcuts from interfering with text input
 */
// export function isUserTyping(event: KeyboardEvent): boolean {
//   const target = event.target as HTMLElement

//   return (
//     target.tagName === 'INPUT' ||
//     target.tagName === 'TEXTAREA' ||
//     target.contentEditable === 'true' ||
//     target.getAttribute('role') === 'textbox' ||
//     target.closest('[contenteditable="true"]') !== null ||
//     target.closest('input') !== null ||
//     target.closest('textarea') !== null
//   )
// }

// /**
//  * Check if a keyboard event should be ignored due to user typing
//  * Also checks for common input contexts and editor states
//  */
// export function shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
//   // Check if user is typing
//   if (isUserTyping(event)) {
//     return true
//   }

//   // Don't ignore modal shortcuts unless specifically typing
//   return false
// }

/**
 * Safely add a keyboard event listener that respects input fields
 */
// export function addSafeKeyboardListener(
//   eventType: 'keydown' | 'keyup' | 'keypress',
//   handler: (event: KeyboardEvent) => void,
//   options?: {
//     element?: EventTarget
//     respectInputs?: boolean
//   }
// ) {
//   const { element = window, respectInputs = true } = options || {}

//   const safeHandler = (event: Event) => {
//     const keyboardEvent = event as KeyboardEvent
//     if (respectInputs && shouldIgnoreKeyboardEvent(keyboardEvent)) {
//       return
//     }
//     handler(keyboardEvent)
//   }

//   element.addEventListener(eventType, safeHandler)

//   return () => {
//     element.removeEventListener(eventType, safeHandler)
//   }
// }
