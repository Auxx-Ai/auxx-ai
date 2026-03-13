// apps/web/src/components/custom-fields/utils/get-next-icon-color.ts
import { ICON_COLORS } from '@auxx/ui/components/icons'

/**
 * Get the next auto-assigned color for a new entity icon.
 * Cycles through ICON_COLORS in order, skipping colors already in use.
 * Wraps around if all colors are used.
 */
export function getNextIconColor(usedColors: string[]): string {
  const usedSet = new Set(usedColors)

  for (const color of ICON_COLORS) {
    if (!usedSet.has(color.id)) {
      return color.id
    }
  }

  // All colors used — wrap around based on count
  return ICON_COLORS[usedColors.length % ICON_COLORS.length]!.id
}
