// apps/web/src/components/workflow/types/unified-types.ts

/**
 * Unified Type System for Workflow Variables
 *
 * This module provides a single source of truth for type definitions
 * across the entire workflow system, replacing multiple inconsistent
 * type systems with one unified approach.
 */

// ValidationRules moved to lib with UnifiedVariable (node-catalog Phase 1);
// re-exported here so existing imports keep working.
export type { ValidationRules } from '@auxx/lib/workflow-engine/client'
// Import BaseType from backend (single source of truth)
export { BaseType } from '@auxx/lib/workflow-engine/client'
