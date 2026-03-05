// packages/sdk/src/build/workflow-block-modules.ts

import type { Scope } from '@typescript-eslint/scope-manager'

/**
 * Base AST Node type - flexible to support ESLint AST nodes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = any

/**
 * Reference to a component, handler, or schema
 */
export interface ModuleRef {
  /** Absolute path to the module */
  path: string
  /** Export name in the module */
  export: string
}

/**
 * Workflow block definition extracted from source
 */
export interface WorkflowBlockDefinition {
  /** Unique block ID */
  id: string
  /** Display label */
  label: string
  /** Block description */
  description?: string
  /** Block category */
  category?: string
  /** Icon (emoji or component reference) */
  icon?: string
  /** Icon color */
  color?: string
  /** Schema reference */
  schema: ModuleRef
  /** Node component reference */
  node?: ModuleRef
  /** Panel component reference */
  panel?: ModuleRef
  /** Execute function reference */
  execute: ModuleRef
  /** Block configuration */
  config?: {
    timeout?: number
    retries?: number
    requiresConnection?: boolean
  }
}

/**
 * Workflow trigger definition extracted from source
 */
export interface WorkflowTriggerDefinition {
  /** Unique trigger ID */
  id: string
  /** Display label */
  label: string
  /** Trigger description */
  description?: string
  /** Trigger category */
  category?: string
  /** Icon (emoji or component reference) */
  icon?: string
  /** Icon color */
  color?: string
  /** Schema reference */
  schema: ModuleRef
  /** Node component reference */
  node?: ModuleRef
  /** Panel component reference */
  panel?: ModuleRef
  /** Execute function reference */
  execute: ModuleRef
  /** Trigger configuration */
  config?: {
    timeout?: number
    retries?: number
    requiresConnection?: boolean
    polling?: {
      intervalMinutes?: number
      cron?: string
      minIntervalMinutes?: number
    }
  }
}

/**
 * Result of parsing workflow blocks and triggers from app
 */
export interface WorkflowModules {
  blocks: Map<string, WorkflowBlockDefinition>
  triggers: Map<string, WorkflowTriggerDefinition>
}

/**
 * Extract string literal value from AST node
 */
export function extractStringLiteral(node: ASTNode): string | undefined {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  return undefined
}

/**
 * Extract number literal value from AST node
 */
export function extractNumberLiteral(node: ASTNode): number | undefined {
  if (node.type === 'Literal' && typeof node.value === 'number') {
    return node.value
  }
  return undefined
}

/**
 * Extract boolean literal value from AST node
 */
export function extractBooleanLiteral(node: ASTNode): boolean | undefined {
  if (node.type === 'Literal' && typeof node.value === 'boolean') {
    return node.value
  }
  return undefined
}

/**
 * Extract object properties as a simple record
 */
export function extractObjectProperties(node: ASTNode): Record<string, any> | undefined {
  if (node.type !== 'ObjectExpression') {
    return undefined
  }

  const result: Record<string, any> = {}
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier') {
      continue
    }

    const key = property.key.name
    const value = property.value

    if (value.type === 'Literal') {
      result[key] = value.value
    } else if (value.type === 'ObjectExpression') {
      const nested = extractObjectProperties(value)
      if (nested) result[key] = nested
    }
  }

  return result
}

/**
 * Find a property by name in an object expression
 */
export function findProperty(obj: ASTNode, name: string, scope?: Scope): ASTNode | null {
  if (obj.type !== 'ObjectExpression') {
    return null
  }

  const property = obj.properties.find(
    (property: ASTNode) =>
      property.type === 'Property' &&
      property.key.type === 'Identifier' &&
      property.key.name === name
  )

  if (!property) {
    return null
  }

  let value = property.value

  // Resolve identifiers if scope is provided
  if (value.type === 'Identifier' && scope) {
    const variable = scope.set.get(value.name)
    if (variable && variable.defs.length === 1) {
      const def = variable.defs[0]
      if (def!.node.type === 'VariableDeclarator' && def!.node.init) {
        value = def!.node.init
      }
    }
  }

  return value
}

/**
 * Create a module reference from a property value
 * For now, we'll keep references as simple objects
 * The actual resolution will happen in the build process
 */
export function createModuleRef(
  name: string,
  node: ASTNode,
  currentPath: string
): ModuleRef | undefined {
  // For inline functions or objects, we'll need to handle them differently
  // For now, assume they're references that will be resolved later
  if (node.type === 'Identifier') {
    return {
      path: currentPath,
      export: node.name,
    }
  }

  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    // Inline function - will need special handling
    return {
      path: currentPath,
      export: `inline_${name}`,
    }
  }

  return undefined
}

/**
 * Extract block or trigger definition from an object expression
 */
export function extractWorkflowDefinition(
  node: ASTNode,
  _scope: Scope,
  currentPath: string
): Partial<WorkflowBlockDefinition | WorkflowTriggerDefinition> {
  if (node.type !== 'ObjectExpression') {
    throw new Error('Expected workflow block/trigger to be an object expression')
  }

  const definition: any = {}

  for (const property of node.properties) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier') {
      continue
    }

    const key = property.key.name
    const value = property.value

    switch (key) {
      case 'id':
        definition.id = extractStringLiteral(value)
        break
      case 'label':
        definition.label = extractStringLiteral(value)
        break
      case 'description':
        definition.description = extractStringLiteral(value)
        break
      case 'category':
        definition.category = extractStringLiteral(value)
        break
      case 'icon':
        definition.icon = extractStringLiteral(value)
        break
      case 'color':
        definition.color = extractStringLiteral(value)
        break
      case 'schema':
        definition.schema = createModuleRef(key, value, currentPath)
        break
      case 'node':
        definition.node = createModuleRef(key, value, currentPath)
        break
      case 'panel':
        definition.panel = createModuleRef(key, value, currentPath)
        break
      case 'execute':
        definition.execute = createModuleRef(key, value, currentPath)
        break
      case 'config':
        definition.config = extractObjectProperties(value)
        break
    }
  }

  return definition
}

/**
 * Validate that a workflow definition has required fields
 */
export function validateWorkflowDefinition(
  definition: Partial<WorkflowBlockDefinition | WorkflowTriggerDefinition>,
  type: 'block' | 'trigger'
): definition is WorkflowBlockDefinition | WorkflowTriggerDefinition {
  if (!definition.id) {
    throw new Error(`Workflow ${type} must have an 'id' property`)
  }
  if (!definition.label) {
    throw new Error(`Workflow ${type} '${definition.id}' must have a 'label' property`)
  }
  if (!definition.schema) {
    throw new Error(`Workflow ${type} '${definition.id}' must have a 'schema' property`)
  }
  if (!definition.execute) {
    throw new Error(`Workflow ${type} '${definition.id}' must have an 'execute' property`)
  }
  return true
}
