// apps/web/src/components/resources/store/computed-field-registry.ts

import type { CalcOptions } from '@auxx/lib/custom-fields/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '@auxx/lib/resources/client'
import { FieldType } from '@auxx/database/enums'

/**
 * Configuration for a computed (CALC) field.
 */
interface ComputedFieldConfig {
  fieldId: ResourceFieldId
  expression: string
  /** Map of placeholder name -> source field ID */
  sourceFields: Record<string, string>
  resultFieldType: string
  disabled?: boolean
  disabledReason?: string
}

/**
 * Registry of computed (CALC) fields and their configurations.
 * Populated automatically when resource store's fieldMap changes.
 */
class ComputedFieldRegistry {
  private fields = new Map<ResourceFieldId, ComputedFieldConfig>()

  /** Map of sourceFieldId -> Set of dependent CALC fieldIds */
  private dependencyGraph = new Map<string, Set<ResourceFieldId>>()

  /**
   * Register a CALC field configuration.
   * Called when field definitions are loaded/updated.
   */
  register(fieldId: ResourceFieldId, calcOptions: CalcOptions): void {
    // Clean up old registration first if exists
    this.unregister(fieldId)

    const config: ComputedFieldConfig = {
      fieldId,
      expression: calcOptions.expression,
      sourceFields: calcOptions.sourceFields ?? {},
      resultFieldType: calcOptions.resultFieldType ?? 'TEXT',
      disabled: calcOptions.disabled,
      disabledReason: calcOptions.disabledReason,
    }

    this.fields.set(fieldId, config)

    // Build reverse dependency graph
    for (const sourceFieldId of Object.values(config.sourceFields)) {
      if (!this.dependencyGraph.has(sourceFieldId)) {
        this.dependencyGraph.set(sourceFieldId, new Set())
      }
      this.dependencyGraph.get(sourceFieldId)!.add(fieldId)
    }
  }

  /**
   * Unregister a CALC field (when deleted).
   */
  unregister(fieldId: ResourceFieldId): void {
    const config = this.fields.get(fieldId)
    if (!config) return

    // Remove from dependency graph
    for (const sourceFieldId of Object.values(config.sourceFields)) {
      this.dependencyGraph.get(sourceFieldId)?.delete(fieldId)
    }

    this.fields.delete(fieldId)
  }

  /**
   * Check if a field is a computed field.
   */
  isComputed(fieldId: ResourceFieldId): boolean {
    return this.fields.has(fieldId)
  }

  /**
   * Get configuration for a computed field.
   */
  getConfig(fieldId: ResourceFieldId): ComputedFieldConfig | undefined {
    return this.fields.get(fieldId)
  }

  /**
   * Get all CALC fields that depend on a given source field.
   * Used for cache invalidation.
   */
  getDependentFields(sourceFieldId: string): ResourceFieldId[] {
    return Array.from(this.dependencyGraph.get(sourceFieldId) ?? [])
  }

  /**
   * Get all registered computed fields.
   */
  getAllFields(): ComputedFieldConfig[] {
    return Array.from(this.fields.values())
  }

  /**
   * Clear all registrations (for testing or reset).
   */
  clear(): void {
    this.fields.clear()
    this.dependencyGraph.clear()
  }
}

/** Singleton registry instance */
export const computedFieldRegistry = new ComputedFieldRegistry()

/** Track if sync has been initialized */
let syncInitialized = false

/**
 * Sync CALC fields from fieldMap to registry.
 * Handles additions, updates, and removals.
 */
function syncCalcFields(fieldMap: Record<string, ResourceField>) {
  const currentCalcIds = new Set(computedFieldRegistry.getAllFields().map((f) => f.fieldId))
  const newCalcIds = new Set<string>()

  // Register/update CALC fields
  for (const [resourceFieldId, field] of Object.entries(fieldMap)) {
    if (field.fieldType === FieldType.CALC && field.options?.calc) {
      newCalcIds.add(resourceFieldId)

      // Register (will update if already exists)
      computedFieldRegistry.register(
        resourceFieldId as ResourceFieldId,
        field.options.calc as CalcOptions
      )
    }
  }

  // Unregister removed CALC fields
  for (const oldId of currentCalcIds) {
    if (!newCalcIds.has(oldId)) {
      computedFieldRegistry.unregister(oldId as ResourceFieldId)
    }
  }
}

/**
 * Auto-sync CALC fields from resource store to computed field registry.
 * Called once at app startup. Safe to call multiple times (idempotent).
 */
export function initComputedFieldSync() {
  if (syncInitialized) return
  syncInitialized = true

  // Lazy import to avoid circular dependency
  import('./resource-store').then(({ useResourceStore }) => {
    // Initial sync
    syncCalcFields(useResourceStore.getState().fieldMap)

    // Subscribe to fieldMap changes
    useResourceStore.subscribe(
      (state) => state.fieldMap,
      (fieldMap) => syncCalcFields(fieldMap),
      { equalityFn: Object.is } // Only trigger on reference change
    )
  })
}

export type { ComputedFieldConfig }
