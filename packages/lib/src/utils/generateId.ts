// packages/lib/src/utils/generateId.ts
import { nanoid } from 'nanoid'

/**
 * Generates a unique ID using nanoid
 * @param prefix - Optional prefix to prepend to the ID
 * @returns A unique string ID
 */
export const generateId = (prefix?: string): string => {
  const id = nanoid()
  return prefix ? `${prefix}-${id}` : id
}
