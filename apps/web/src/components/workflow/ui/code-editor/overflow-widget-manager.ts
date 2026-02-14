// apps/web/src/components/workflow/ui/code-editor/overflow-widget-manager.ts

/**
 * Manager for Monaco editor overflow widgets
 * Handles creation and cleanup of DOM containers for completion suggestions
 * that need to extend beyond editor boundaries
 */

const OVERFLOW_CONTAINER_ID = 'monaco-overflow-widgets-container'

let overflowContainer: HTMLElement | null = null
let refCount = 0

/**
 * Creates or reuses the overflow widget container attached to document.body
 * Multiple editors can share the same container
 */
export function createOverflowWidgetContainer(
  theme?: string,
  editorElement?: HTMLElement
): HTMLElement {
  if (!overflowContainer) {
    overflowContainer = document.createElement('div')
    overflowContainer.id = OVERFLOW_CONTAINER_ID
    overflowContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      z-index: 9999;
      pointer-events: none;
    `
    document.body.appendChild(overflowContainer)
  }

  // Update container classes - copy from actual Monaco editor if available
  if (editorElement) {
    // Copy all classes from the Monaco editor element
    overflowContainer.className = editorElement.className
  } else {
    // Fallback to basic Monaco editor classes
    overflowContainer.className = 'monaco-editor'
    if (theme) {
      overflowContainer.classList.add(`vs-theme-${theme}`)
    }
  }

  refCount++
  return overflowContainer
}

/**
 * Releases reference to the overflow widget container
 * Cleans up the container when no editors are using it
 */
export function releaseOverflowWidgetContainer(): void {
  refCount--

  if (refCount <= 0 && overflowContainer) {
    if (overflowContainer.parentNode) {
      overflowContainer.parentNode.removeChild(overflowContainer)
    }
    overflowContainer = null
    refCount = 0
  }
}

/**
 * Gets the current overflow widget container if it exists
 */
export function getOverflowWidgetContainer(): HTMLElement | null {
  return overflowContainer
}

/**
 * Force cleanup of the overflow widget container
 * Useful for testing or when needed to reset state
 */
export function forceCleanupOverflowWidgetContainer(): void {
  if (overflowContainer?.parentNode) {
    overflowContainer.parentNode.removeChild(overflowContainer)
  }
  overflowContainer = null
  refCount = 0
}
