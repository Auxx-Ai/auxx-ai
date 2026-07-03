// apps/web/src/components/resources/store/computed-field-registry.ts

import { FieldType } from '@auxx/database/enums'
import type { CalcOptions, NameFieldOptions } from '@auxx/lib/custom-fields/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'

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

/** Did a (re)registration actually change the computed definition? */
function configChanged(prev: ComputedFieldConfig, next: ComputedFieldConfig): boolean {
  return (
    prev.expression !== next.expression ||
    prev.resultFieldType !== next.resultFieldType ||
    prev.disabled !== next.disabled ||
    JSON.stringify(prev.sourceFields) !== JSON.stringify(next.sourceFields)
  )
}

/**
 * Sync CALC fields from fieldMap to registry.
 * Handles additions, updates, and removals.
 * Returns the fieldIds whose config is new or changed, so callers can
 * recompute already-loaded values (registration alone never recomputes).
 */
function syncCalcFields(fieldMap: Record<string, ResourceField>): ResourceFieldId[] {
  const currentCalcIds = new Set(computedFieldRegistry.getAllFields().map((f) => f.fieldId))
  const newCalcIds = new Set<string>()
  const changedIds: ResourceFieldId[] = []

  const registerAndDiff = (resourceFieldId: ResourceFieldId, calcOptions: CalcOptions) => {
    const prev = computedFieldRegistry.getConfig(resourceFieldId)
    computedFieldRegistry.register(resourceFieldId, calcOptions)
    const next = computedFieldRegistry.getConfig(resourceFieldId)!
    if (!prev || configChanged(prev, next)) {
      changedIds.push(resourceFieldId)
    }
  }

  // Register/update CALC and NAME fields
  for (const [resourceFieldId, field] of Object.entries(fieldMap)) {
    // Register CALC fields
    if (field.fieldType === FieldType.CALC && field.options?.calc) {
      newCalcIds.add(resourceFieldId)
      registerAndDiff(resourceFieldId as ResourceFieldId, field.options.calc as CalcOptions)
    }

    // Register NAME fields (treated as computed fields)
    if (field.fieldType === FieldType.NAME && field.options?.name) {
      const nameOptions = field.options.name as NameFieldOptions
      newCalcIds.add(resourceFieldId)

      // Convert NAME options to CalcOptions format for registry
      registerAndDiff(resourceFieldId as ResourceFieldId, {
        expression: '', // Empty = NAME field (no expression evaluation)
        sourceFields: {
          firstName: nameOptions.firstNameFieldId,
          lastName: nameOptions.lastNameFieldId,
        },
        resultFieldType: FieldType.NAME,
      })
    }
  }

  // Unregister removed CALC fields
  for (const oldId of currentCalcIds) {
    if (!newCalcIds.has(oldId)) {
      computedFieldRegistry.unregister(oldId as ResourceFieldId)
    }
  }

  return changedIds
}

/**
 * Sync the registry from a fieldMap, then recompute already-loaded values for
 * any calc whose definition is new or changed. Recomputing on registration is
 * what makes expression edits (including optimistic field updates) show up in
 * cells without a reload, and heals values that were fetched before the
 * registry was ready.
 */
function syncCalcFieldsAndRecompute(fieldMap: Record<string, ResourceField>) {
  const changedIds = syncCalcFields(fieldMap)
  if (changedIds.length === 0) return

  // Lazy import: calc-value-computer statically imports this module
  import('./calc-value-computer').then(({ recomputeCalcField }) => {
    for (const fieldId of changedIds) {
      recomputeCalcField(fieldId)
    }
  })
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
    syncCalcFieldsAndRecompute(useResourceStore.getState().fieldMap)

    // Subscribe to fieldMap changes
    useResourceStore.subscribe(
      (state) => state.fieldMap,
      (fieldMap) => syncCalcFieldsAndRecompute(fieldMap),
      { equalityFn: Object.is } // Only trigger on reference change
    )
  })
}

export type { ComputedFieldConfig }
