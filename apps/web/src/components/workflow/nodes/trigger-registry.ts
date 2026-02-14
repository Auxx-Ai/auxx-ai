// apps/web/src/components/workflow/nodes/trigger-registry.ts

import type { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import type { ComponentType } from 'react'
import type { ValidationResult } from '../types'

/**
 * Props interface for trigger input components
 */
export interface TriggerInputProps {
  /** Current input values */
  inputs: Record<string, any>
  /** Current validation errors */
  errors: Record<string, string>
  /** Handler for input changes */
  onChange: (name: string, value: any) => void
  /** Loading state */
  isLoading?: boolean
}

/**
 * Configuration for trigger-specific inputs
 */
export interface TriggerInputConfig {
  /** Component to render for this trigger's inputs */
  component: ComponentType<TriggerInputProps>
  /** Validate the inputs for this trigger */
  validate: (inputs: Record<string, any>) => ValidationResult
  /** Get default inputs for this trigger */
  getDefaultInputs: () => Record<string, any>
  /** Description of what this trigger does */
  description: string
  /** Required data fields this trigger expects */
  requiredData?: string[]
}

/**
 * Registry mapping trigger types to their input configurations
 * This will be populated as we create trigger input components
 */
export const triggerRegistry: Partial<Record<WorkflowTriggerType, TriggerInputConfig>> = {}

/**
 * Registry for dynamic triggers (e.g., resource triggers that all use EVENT type)
 * Maps specific node types to their configurations
 */
export const dynamicTriggerRegistry: Record<string, TriggerInputConfig> = {}

/**
 * Register a trigger input configuration
 */
export function registerTriggerInput(
  triggerType: WorkflowTriggerType,
  config: TriggerInputConfig
): void {
  triggerRegistry[triggerType] = config
}

/**
 * Register a dynamic trigger input configuration (for EVENT type triggers)
 */
export function registerDynamicTriggerInput(nodeType: string, config: TriggerInputConfig): void {
  dynamicTriggerRegistry[nodeType] = config
}

/**
 * Get trigger input configuration
 */
export function getTriggerInputConfig(
  triggerType: WorkflowTriggerType
): TriggerInputConfig | undefined {
  return triggerRegistry[triggerType]
}

/**
 * Get trigger input configuration by node type (for dynamic triggers)
 */
export function getTriggerInputConfigByNodeType(nodeType: string): TriggerInputConfig | undefined {
  return dynamicTriggerRegistry[nodeType]
}

/**
 * Check if a trigger type has an input configuration
 */
export function hasTriggerInputConfig(triggerType: WorkflowTriggerType): boolean {
  return triggerType in triggerRegistry
}

/**
 * Check if a node type has a dynamic trigger input configuration
 */
export function hasDynamicTriggerInputConfig(nodeType: string): boolean {
  return nodeType in dynamicTriggerRegistry
}

/**
 * Get all registered dynamic trigger node types
 */
export function getDynamicTriggerNodeTypes(): string[] {
  return Object.keys(dynamicTriggerRegistry)
}
