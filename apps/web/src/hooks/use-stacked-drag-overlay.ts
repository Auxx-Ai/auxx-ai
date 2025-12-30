// apps/web/src/hooks/use-stacked-drag-overlay.ts

import { useMemo, type CSSProperties } from 'react'

/**
 * Options for useStackedDragOverlay hook
 */
interface UseStackedDragOverlayOptions {
  /** Total number of items being dragged */
  count: number
  /** Maximum number of cards to visually stack (default: 5) */
  maxVisible?: number
  /** Base rotation magnitude in degrees (default: 1) */
  rotationMagnitude?: number
  /** Rotation increment per card (default: 0.5) */
  rotationIncrement?: number
  /** Translation offset per card in pixels (default: 3) */
  translateOffset?: number
  /** Scale decrement per card (default: 0.02) */
  scaleDecrement?: number
}

/**
 * Result from useStackedDragOverlay hook
 */
interface StackedDragOverlayResult {
  /** Get style object for a specific render index (0 = top card) */
  getItemStyle: (renderIndex: number) => CSSProperties
  /** Number of items to actually render */
  displayCount: number
  /** Whether to show the count badge */
  showBadge: boolean
  /** Total count of items being dragged */
  totalCount: number
  /** Array of item indices in render order (reversed for proper stacking) */
  indices: number[]
}

/**
 * Hook for creating stacked drag overlay styles.
 * Returns style helpers for rendering multiple items in a stacked, rotated layout.
 *
 * @example
 * ```tsx
 * const { getItemStyle, indices, showBadge, totalCount } = useStackedDragOverlay({
 *   count: items.length,
 * })
 *
 * return (
 *   <div className="relative">
 *     {showBadge && <Badge>{totalCount}</Badge>}
 *     {indices.map((itemIndex, renderIndex) => (
 *       <div key={items[itemIndex].id} style={getItemStyle(renderIndex)}>
 *         {renderItem(items[itemIndex])}
 *       </div>
 *     ))}
 *   </div>
 * )
 * ```
 */
export function useStackedDragOverlay({
  count,
  maxVisible = 5,
  rotationMagnitude = 1,
  rotationIncrement = 0.5,
  translateOffset = 3,
  scaleDecrement = 0.02,
}: UseStackedDragOverlayOptions): StackedDragOverlayResult {
  return useMemo(() => {
    const displayCount = Math.min(count, maxVisible)

    /**
     * Calculate rotation for a card at given render index.
     * Top card (0) has no rotation, others alternate direction.
     */
    const getRotation = (renderIndex: number): number => {
      if (renderIndex === 0) return 0
      const magnitude = rotationMagnitude + (renderIndex - 1) * rotationIncrement
      const direction = renderIndex % 2 === 1 ? -1 : 1
      return magnitude * direction
    }

    /**
     * Calculate translation offset for stacking effect.
     */
    const getTranslate = (renderIndex: number): number => {
      if (renderIndex === 0) return 0
      return renderIndex * translateOffset
    }

    /**
     * Get complete style object for a card at given render index.
     */
    const getItemStyle = (renderIndex: number): CSSProperties => ({
      zIndex: displayCount - renderIndex,
      transform: `translateX(-${getTranslate(renderIndex)}px) translateY(-${getTranslate(renderIndex)}px) rotate(${getRotation(renderIndex)}deg) scale(${1 - renderIndex * scaleDecrement})`,
      transition: 'transform 0.1s ease-out',
      position: renderIndex === 0 ? 'relative' : 'absolute',
      left: renderIndex === 0 ? undefined : 0,
      top: renderIndex === 0 ? undefined : 0,
    })

    // Generate indices in reverse order so last item renders first (bottom of stack)
    // and first item renders last (top of stack, visible)
    const indices = Array.from({ length: displayCount }, (_, i) => displayCount - 1 - i)

    return {
      getItemStyle,
      displayCount,
      showBadge: count > 1,
      totalCount: count,
      indices,
    }
  }, [count, maxVisible, rotationMagnitude, rotationIncrement, translateOffset, scaleDecrement])
}
