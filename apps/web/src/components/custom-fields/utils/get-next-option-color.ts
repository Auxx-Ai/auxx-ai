// apps/web/src/components/custom-fields/utils/get-next-option-color.ts
import { OPTION_COLORS, type SelectOptionColor } from '@auxx/lib/custom-fields/client'

/**
 * Get the next auto-assigned color for a new option/column.
 * Cycles through OPTION_COLORS in order, skipping colors already in use.
 * Wraps around if all colors are used.
 */
export function getNextOptionColor(usedColors: SelectOptionColor[]): SelectOptionColor {
  const usedSet = new Set(usedColors)

  for (const color of OPTION_COLORS) {
    if (!usedSet.has(color.id)) {
      return color.id
    }
  }

  // All colors used — wrap around based on count
  return OPTION_COLORS[usedColors.length % OPTION_COLORS.length]!.id
}
