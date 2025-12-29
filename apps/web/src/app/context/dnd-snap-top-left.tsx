// You can define this modifier function either inside your layout component
// where DndContext lives, or import it from a utility file.

import type { Modifier } from '@dnd-kit/core'

/**
 * dnd-kit DragOverlay Modifier:
 * Snaps the overlay's top-left corner to the cursor's position.
 * Optionally adds a small offset (e.g., so cursor isn't directly over content).
 */
export const snapTopLeftToCursor: Modifier = ({ transform, activeNodeRect, draggingNodeRect }) => {
  if (!activeNodeRect || !draggingNodeRect) {
    // Not enough info yet, return default transform
    return transform
  }

  // Calculate the difference between the cursor's initial grab point on the node
  // and the node's actual top-left corner.
  const initialGrabOffsetX = transform.x + activeNodeRect.left - draggingNodeRect.left
  const initialGrabOffsetY = transform.y + activeNodeRect.top - draggingNodeRect.top

  // Calculate the new transform to place the top-left corner under the cursor
  // by subtracting the initial offset from the current transform.
  const newX = transform.x - initialGrabOffsetX
  const newY = transform.y - initialGrabOffsetY

  // Optional: Add a small offset (e.g., 5px down and right)
  const offsetX = 5
  const offsetY = 5

  return {
    ...transform, // Keep scale if needed
    x: newX + offsetX,
    y: newY + offsetY,
  }
}

// --- Simpler version (often sufficient if scale isn't changing): ---
// This assumes the overlay wrapper's position directly follows the cursor's delta movement.
// We just need to nullify the initial grab offset.
export const snapToCursorSimple: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (draggingNodeRect && activatorEvent) {
    const initialX = 'clientX' in activatorEvent ? activatorEvent.clientX : 0
    const initialY = 'clientY' in activatorEvent ? activatorEvent.clientY : 0

    const offsetX = initialX - draggingNodeRect.left
    const offsetY = initialY - draggingNodeRect.top

    return {
      ...transform,
      x: transform.x - offsetX + 5, // Add small visual offset
      y: transform.y - offsetY + 5, // Add small visual offset
    }
  }
  return transform
}
