// apps/web/src/components/workflow/nodes/unified-registry.ts

import type React from 'react'
import { NodeCategory, type NodeDefinition, type ValidationResult } from '../types'
import { getIcon } from '../utils/icon-helper'

/**
 * Unified node registry for managing node definitions
 */
class UnifiedNodeRegistry {
  private definitions = new Map<string, NodeDefinition>()
  private categories = new Map<NodeCategory, string[]>()
  private isInitialized = false
  private changeListeners = new Set<(changedIds: string[]) => void>()
  private version = 0

  /**
   * Register a node definition
   */
  register(definition: NodeDefinition, options?: { allowUpdate?: boolean }): void {
    const exists = this.definitions.has(definition.id)

    if (exists && !options?.allowUpdate) {
      console.warn(
        `Node definition ${definition.id} is already registered. ` +
          `Use { allowUpdate: true } to update existing definition.`
      )
      return
    }

    this.definitions.set(definition.id, definition)
    this.updateCategoryIndex(definition)
    this.notifyChange([definition.id])
  }

  /**
   * Register or update a node definition (forces update if exists)
   */
  registerOrUpdate(definition: NodeDefinition): void {
    this.register(definition, { allowUpdate: true })
  }

  /**
   * Update category index for a definition
   */
  private updateCategoryIndex(definition: NodeDefinition): void {
    // Update category index - prevent duplicates
    if (!this.categories.has(definition.category)) {
      this.categories.set(definition.category, [])
    }

    const categoryNodes = this.categories.get(definition.category)!
    if (!categoryNodes.includes(definition.id)) {
      categoryNodes.push(definition.id)
    }
  }

  /**
   * Subscribe to registry changes
   * @param listener - Receives array of changed definition IDs
   * @returns Unsubscribe function
   */
  subscribe(listener: (changedIds: string[]) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  /**
   * Notify all listeners of changes with the IDs that changed
   */
  private notifyChange(changedIds: string[]): void {
    this.version++
    this.changeListeners.forEach((listener) => listener(changedIds))
  }

  /** Snapshot for useSyncExternalStore — returns version counter */
  getVersion = (): number => {
    return this.version
  }

  /**
   * Register multiple definitions
   */
  registerMany(definitions: NodeDefinition[]): void {
    const changedIds: string[] = []
    for (const def of definitions) {
      const exists = this.definitions.has(def.id)
      if (exists) {
        console.warn(
          `Node definition ${def.id} is already registered. ` +
            `Use { allowUpdate: true } to update existing definition.`
        )
        continue
      }
      this.definitions.set(def.id, def)
      this.updateCategoryIndex(def)
      changedIds.push(def.id)
    }
    if (changedIds.length > 0) {
      this.notifyChange(changedIds)
    }
  }

  /**
   * Get a node definition
   */
  getDefinition(type: string): NodeDefinition | undefined {
    return this.definitions.get(type)
  }

  /**
   * Get component for a node type (for dynamic rendering in StandardNode)
   */
  getComponent(nodeType: string): React.ComponentType<any> | undefined {
    const definition = this.getDefinition(nodeType)
    return definition?.component
  }

  /**
   * Check if a node type has a component registered
   */
  hasComponent(nodeType: string): boolean {
    return !!this.getComponent(nodeType)
  }

  /**
   * Get all definitions
   */
  getAllDefinitions(): NodeDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Get all definition entries (including keys)
   */
  getAllEntries(): Array<[string, NodeDefinition]> {
    return Array.from(this.definitions.entries())
  }

  /**
   * Get definitions by category
   */
  getByCategory(category: NodeCategory): NodeDefinition[] {
    const types = this.categories.get(category) || []
    return types
      .map((type) => this.definitions.get(type))
      .filter((def): def is NodeDefinition => def !== undefined)
  }

  /**
   * Get all categories with their nodes
   */
  getCategorizedNodes(): Record<NodeCategory, NodeDefinition[]> {
    const result: Record<NodeCategory, NodeDefinition[]> = {} as any

    for (const category of Object.values(NodeCategory)) {
      result[category] = this.getByCategory(category)
    }

    return result
  }

  /**
   * Search definitions
   */
  search(query: string): NodeDefinition[] {
    const lowerQuery = query.toLowerCase()

    return this.getAllDefinitions().filter(
      (def) =>
        def.displayName.toLowerCase().includes(lowerQuery) ||
        def.description.toLowerCase().includes(lowerQuery) ||
        def.category.toLowerCase().includes(lowerQuery)
    )
  }

  /**
   * Check if a type is registered
   */
  has(type: string): boolean {
    return this.definitions.has(type)
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.definitions.clear()
    this.categories.clear()
    this.isInitialized = false
  }

  /**
   * Check if registry is initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized
  }

  /**
   * Mark registry as initialized
   */
  markInitialized(): void {
    this.isInitialized = true
  }

  /**
   * Validate registry for duplicates and inconsistencies
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check for orphaned category entries
    this.categories.forEach((nodeIds, category) => {
      nodeIds.forEach((nodeId) => {
        if (!this.definitions.has(nodeId)) {
          errors.push(`Category ${category} contains non-existent node: ${nodeId}`)
        }
      })
    })

    // Check for missing category entries
    this.definitions.forEach((definition, nodeId) => {
      const categoryNodes = this.categories.get(definition.category)
      if (!categoryNodes || !categoryNodes.includes(nodeId)) {
        errors.push(`Node ${nodeId} not found in its category ${definition.category}`)
      }
    })

    return { isValid: errors.length === 0, errors }
  }

  /**
   * Get registry statistics for debugging
   */
  getStats(): {
    totalNodes: number
    nodesByCategory: Record<string, number>
    duplicatesFound: number
  } {
    const stats = {
      totalNodes: this.definitions.size,
      nodesByCategory: {} as Record<string, number>,
      duplicatesFound: 0,
    }

    // Count nodes by category
    this.categories.forEach((nodeIds, category) => {
      stats.nodesByCategory[category] = nodeIds.length

      // Check for duplicates within category
      const uniqueIds = new Set(nodeIds)
      if (uniqueIds.size !== nodeIds.length) {
        stats.duplicatesFound += nodeIds.length - uniqueIds.size
      }
    })

    return stats
  }

  /**
   * Get icon component for a node type
   * @param nodeType - The node type
   * @param className - CSS class for the icon
   * @param data - Optional node data for dynamic icon resolution
   */
  getNodeIcon(nodeType: string, className: string = 'size-4', data?: any): React.ReactElement {
    const definition = this.getDefinition(nodeType)
    if (definition) {
      // Use dynamic getIcon if available and data is provided
      const iconName = definition.getIcon && data ? definition.getIcon(data) : definition.icon
      if (iconName) {
        return getIcon(iconName, className)
      }
    }

    // Fallback to default icon
    return getIcon('box', className)
  }

  /**
   * Get icon name for a node type
   * @param nodeType - The node type
   * @param data - Optional node data for dynamic icon resolution
   */
  getNodeIconName(nodeType: string, data?: any): string {
    const definition = this.getDefinition(nodeType)
    if (definition) {
      return definition.getIcon && data ? definition.getIcon(data) : definition.icon || 'box'
    }
    return 'box'
  }

  /**
   * Get color for a node type
   */
  getColor(nodeType: string): string {
    const definition = this.getDefinition(nodeType)

    if (definition?.color) {
      return definition.color
    }

    // Default color if none available
    return '#8B5CF6' // gray-500
  }

  /**
   * Get panel component for a node type
   */
  getPanel(nodeType: string): React.ComponentType<{ nodeId: string }> | undefined {
    const definition = this.getDefinition(nodeType)
    return definition?.panel
  }

  /**
   * Get validator function for a node type
   */
  getValidator(nodeType: string): ((config: any) => ValidationResult) | undefined {
    const definition = this.getDefinition(nodeType)
    return definition?.validator
  }

  /**
   * Validate node data
   */
  validateNode(nodeType: string, data: any): ValidationResult {
    const validator = this.getValidator(nodeType)

    if (!validator) {
      return { isValid: true, errors: [] }
    }

    return validator(data)
  }

  /**
   * Check if a node type has a panel
   */
  hasPanel(nodeType: string): boolean {
    const definition = this.getDefinition(nodeType)
    return !!definition?.panel
  }

  /**
   * Get connectable node definitions
   * Filters out nodes where canConnect is explicitly set to false
   */
  getConnectableDefinitions(): NodeDefinition[] {
    return this.getAllDefinitions().filter((definition) => definition.canConnect !== false)
  }

  /**
   * Get allowed target node types for a given node type
   */
  availableNextNodesForType(nodeType: string): string[] {
    const definition = this.getDefinition(nodeType)
    if (!definition) return []

    // If availableNextNodes is explicitly defined, use it
    if (definition.availableNextNodes) {
      return definition.availableNextNodes
    }

    // Special handling for INPUT category nodes
    if (definition.category === NodeCategory.INPUT) {
      // INPUT nodes can only connect to nodes that accept input connections
      return this.getAllDefinitions()
        .filter((def) => def.acceptsInputNodes === true)
        .map((def) => def.id)
    }

    // Default rules based on node type
    if (definition.triggerType) {
      // Trigger nodes can connect to all nodes except other triggers
      return this.getAllDefinitions()
        .filter((def) => !def.triggerType && def.canConnect !== false)
        .map((def) => def.id)
    }

    // All other nodes can connect to any connectable node by default
    return this.getConnectableDefinitions().map((def) => def.id)
  }

  /**
   * Get allowed source node types for a given node type
   */
  availablePrevNodesForType(nodeType: string): string[] {
    const definition = this.getDefinition(nodeType)
    if (!definition) return []

    // If availablePrevNodes is explicitly defined, use it
    if (definition.availablePrevNodes) {
      return definition.availablePrevNodes
    }

    // Default rules: any connectable node can connect to this node
    // except if this is a trigger node (triggers cannot have incoming connections from other nodes)
    if (definition.triggerType) {
      return [] // Trigger nodes don't accept incoming connections
    }

    let allowedPrevNodes = this.getConnectableDefinitions().map((def) => def.id)

    // Special handling: if this node accepts input connections, also allow INPUT category nodes
    if (definition.acceptsInputNodes === true) {
      const inputNodes = this.getInputDefinitions().map((def) => def.id)
      allowedPrevNodes = [...allowedPrevNodes, ...inputNodes]
    }

    return allowedPrevNodes
  }

  /**
   * Get all trigger node types
   */
  get startTriggerNodes(): string[] {
    return this.getAllDefinitions()
      .filter((def) => def.triggerType !== undefined)
      .map((def) => def.id)
  }

  /**
   * Get all trigger node definitions (excluding hidden ones)
   */
  getTriggerDefinitions(): NodeDefinition[] {
    return this.getAllDefinitions().filter(
      (def) => def.triggerType !== undefined && !(def as any).hidden
    )
  }

  /**
   * Get all input node definitions
   */
  getInputDefinitions(): NodeDefinition[] {
    return this.getByCategory(NodeCategory.INPUT)
  }

  /**
   * Get all flow definitions (non-trigger, non-input)
   */
  getFlowDefinitions(): NodeDefinition[] {
    return this.getAllDefinitions().filter(
      (def) => def.triggerType === undefined && def.category !== NodeCategory.INPUT
    )
  }

  /**
   * Check if a node type accepts input connections
   */
  acceptsInputNodes(nodeType: string): boolean {
    const definition = this.getDefinition(nodeType)
    return definition?.acceptsInputNodes === true
  }

  /**
   * Check if a node type is an input node
   */
  isInputNode(nodeType: string): boolean {
    const definition = this.getDefinition(nodeType)
    return definition?.category === NodeCategory.INPUT
  }

  /**
   * Get all non-trigger node definitions
   * @deprecated Use getFlowDefinitions() instead
   */
  getNonTriggerDefinitions(): NodeDefinition[] {
    return this.getFlowDefinitions()
  }

  /**
   * Check if a node type is a trigger node
   */
  isTrigger(nodeType: string): boolean {
    const definition = this.getDefinition(nodeType)
    return definition?.triggerType !== undefined || definition?.category === NodeCategory.TRIGGER
  }
}

// Global unified registry instance
export const unifiedNodeRegistry = new UnifiedNodeRegistry()

// Export for use in components
// export { UnifiedNodeRegistry }
