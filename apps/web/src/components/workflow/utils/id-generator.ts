// apps/web/src/components/workflow/utils/id-generator.ts
import { generateId } from '@auxx/utils/generateId'

/**
 * Centralized ID generation utility for workflow components
 * Ensures unique IDs across all workflow entities
 */

// Re-export generateId for convenience
export { generateId }

/**
 * Generate a node ID
 */
export const generateNodeId = (): string => generateId('node')

/**
 * Generate an edge ID
 */
export const generateEdgeId = (): string => generateId('edge')

/**
 * Generate a condition ID
 */
export const generateConditionId = (): string => generateId('condition')

/**
 * Generate a case ID
 */
export const generateCaseId = (): string => generateId('case')

/**
 * Validate that an ID is not empty and appears unique
 */
export const validateId = (id: string): boolean => {
  return typeof id === 'string' && id.trim().length > 0
}

/**
 * Create a set-based ID collision detector for runtime validation
 */
// export class IdCollisionDetector {
//   private usedIds = new Set<string>()

//   /**
//    * Check if an ID is already used
//    */
//   hasId(id: string): boolean {
//     return this.usedIds.has(id)
//   }

//   /**
//    * Register a new ID and check for collisions
//    */
//   registerAndCheck(id: string, entityType?: string): boolean {
//     if (this.usedIds.has(id)) {
//       console.warn(`ID collision detected for ${entityType || 'entity'}: ${id}`)
//       return false
//     }

//     this.usedIds.add(id)
//     return true
//   }

//   /**
//    * Remove an ID from tracking
//    */
//   removeId(id: string): void {
//     this.usedIds.delete(id)
//   }

//   /**
//    * Clear all tracked IDs
//    */
//   clear(): void {
//     this.usedIds.clear()
//   }

//   /**
//    * Get statistics
//    */
//   getStats(): { totalIds: number; ids: string[] } {
//     return {
//       totalIds: this.usedIds.size,
//       ids: Array.from(this.usedIds)
//     }
//   }
// }

// Global collision detector instance
// export const globalIdDetector = new IdCollisionDetector()
