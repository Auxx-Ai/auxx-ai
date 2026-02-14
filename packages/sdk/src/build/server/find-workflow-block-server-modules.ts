import fs from 'node:fs'
import { parse } from '@typescript-eslint/parser'
import type { Scope } from '@typescript-eslint/scope-manager'
import { analyze } from '@typescript-eslint/scope-manager'
import { walk } from 'zimmerframe'
import { complete, errored } from '../../errors.js'
import { getAppEntryPoint } from '../../util/get-app-entry-point.js'

/**
 * Base AST Node type - flexible to support ESLint AST nodes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = any

/**
 * Handler reference with path and export information
 */
interface HandlerRef {
  path: string
  export: string
}

/**
 * Property type for validation rules (server-side only properties)
 */
type PropertyType = 'schema' | 'execute' | 'activate' | 'deactivate'

/**
 * Block module structure containing handlers and schema
 * Note: Properties can be null when defined inline in the workflow file
 * (currently only schema supports inline definitions)
 */
export interface BlockModule {
  execute?: HandlerRef | null
  schema?: HandlerRef | null
  activate?: HandlerRef | null
  deactivate?: HandlerRef | null
}

/**
 * Import binding definition from scope analysis
 */
interface ImportBinding {
  type: 'ImportBinding'
  parent: ASTNode
  name: ASTNode
}

/**
 * Module information including AST, scope, and exports
 */
interface ModuleInfo {
  content: string
  ast: ASTNode
  scope: Scope | null
  namedExports: Map<string, ASTNode | ImportBinding>
  path: string
}

/**
 * Helper functions for module resolution
 */
interface Helpers {
  getModuleSource: (path: string) => string
  doesModuleExist: (path: string) => boolean
  modules: Map<string, ModuleInfo>
}

/**
 * Check if a path exists using the provided doesModuleExist function
 */
function checkPath(path: string, doesModuleExist: (path: string) => boolean): string | null {
  if (doesModuleExist(path)) {
    return path
  }
  return null
}

/**
 * Resolve a path with common file extensions (.ts, .tsx, .js)
 */
function resolvePathWithExtension(
  path: string,
  doesModuleExist: (path: string) => boolean
): string | null {
  return (
    checkPath(path + '.ts', doesModuleExist) ||
    checkPath(path + '.tsx', doesModuleExist) ||
    checkPath(path + '.js', doesModuleExist)
  )
}

/**
 * Load and parse a module file, caching the result
 */
function loadModule(sourcePath: string, currPath: string, helpers: Helpers): ModuleInfo {
  const absolutePath = resolveAbsolutePath(sourcePath, currPath)
  const fullPath = resolvePathWithExtension(absolutePath, helpers.doesModuleExist)
  if (!fullPath) {
    throw new Error(`Unable to resolve path for module ${sourcePath} from ${currPath}`)
  }
  const modules = helpers.modules
  if (modules.has(fullPath)) {
    return modules.get(fullPath)!
  }
  const content = helpers.getModuleSource(fullPath)
  const ast = parse(content, {
    range: true,
    jsx: true,
  })
  const scopeManager = analyze(ast, {
    sourceType: 'module',
  })
  const moduleScope = scopeManager.acquire(ast, true)
  const namedExports = new Map()
  const module = {
    content,
    ast,
    scope: moduleScope,
    namedExports,
    path: fullPath,
  }
  modules.set(fullPath, module)
  ;(walk as any)(ast, null, {
    ExportNamedDeclaration(node: ASTNode) {
      if (
        node.declaration?.type === 'VariableDeclaration' &&
        node.declaration.declarations.length === 1 &&
        node.declaration.declarations[0].type === 'VariableDeclarator' &&
        node.declaration.declarations[0].id.type === 'Identifier'
      ) {
        const declaration = node.declaration.declarations[0]
        const id = declaration.id
        const init = declaration.init
        if (init?.type === 'Identifier' && moduleScope) {
          const resolved = resolveIdentifierToValue(init, moduleScope)
          if (resolved?.type !== 'ImportBinding') {
            namedExports.set(id.name, declaration.init)
            return
          }
        }
        namedExports.set(id.name, declaration.init)
      }
      if (node?.specifiers && moduleScope) {
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ExportSpecifier' &&
            specifier.exported.type === 'Identifier' &&
            specifier.local.type === 'Identifier'
          ) {
            if (node.source !== null) {
              namedExports.set(specifier.exported.name, node)
            } else {
              const resolved = resolveIdentifierToValue(specifier.local, moduleScope)
              namedExports.set(specifier.exported.name, resolved)
            }
          }
        }
      }
    },
    ExportDefaultDeclaration(node: ASTNode) {
      // Handle default exports: export default function foo() {}
      // This enables .server files to use default exports
      if (node.declaration) {
        if (
          node.declaration.type === 'FunctionDeclaration' ||
          node.declaration.type === 'ArrowFunctionExpression' ||
          node.declaration.type === 'FunctionExpression'
        ) {
          namedExports.set('default', node.declaration)
        } else if (node.declaration.type === 'Identifier') {
          // For: const foo = () => {}; export default foo
          const resolved = resolveIdentifierToValue(node.declaration, moduleScope!)
          namedExports.set('default', resolved)
        }
      }
    },
  })
  return module
}

/**
 * Unwrap TypeScript type assertion nodes to get the actual expression
 * Handles: satisfies, as, type assertions
 */
function unwrapTypeAnnotations(node: ASTNode): ASTNode {
  while (node) {
    if (node.type === 'TSSatisfiesExpression' || node.type === 'TSAsExpression') {
      node = node.expression
    } else if (node.type === 'TSTypeAssertion') {
      node = node.expression
    } else {
      break
    }
  }
  return node
}

/**
 * Resolve an identifier to its value in the given scope
 */
function resolveIdentifierToValue(node: ASTNode, scope: Scope): ASTNode | ImportBinding | null {
  const variable = scope.set.get(node.name)
  if (!variable) {
    throw new Error(`Unable to find variable ${node.name} in scope`)
  }
  if (variable.defs.length !== 1) {
    throw new Error(
      `Expected exactly one definition for variable ${node.name}, found ${variable.defs.length}`
    )
  }
  const def = variable.defs[0]
  if (!def) {
    return null
  }
  if (def.node.type === 'VariableDeclarator') {
    return def.node.init
  }
  if (def.type == 'ImportBinding') {
    return def
  }
  return null
}

/**
 * Resolve relative paths to absolute paths
 */
function resolveAbsolutePath(sourcePath: string, currPath: string): string {
  if (sourcePath.startsWith('.')) {
    const currDir = currPath.split('/').slice(0, -1).join('/')
    const combinedPath = currDir + '/' + sourcePath
    const parts = combinedPath.split('/')
    const resolvedParts = []
    for (const part of parts) {
      if (part === '..') {
        resolvedParts.pop()
      } else if (part !== '.') {
        resolvedParts.push(part)
      }
    }
    return resolvedParts.join('/')
  }
  return sourcePath
}

/**
 * Capture the import path and export name for a handler reference
 * Returns null for allowed inline definitions (schemas only)
 * Throws error for disallowed inline definitions (server functions: execute, activate, deactivate)
 */
function captureImportPath(
  name: string,
  node: ASTNode,
  scope: Scope,
  currPath: string,
  helpers: Helpers,
  propertyType: PropertyType
): HandlerRef | null {
  let importValue = node.type === 'Identifier' ? resolveIdentifierToValue(node, scope) : node

  if (!importValue) {
    throw new Error(`Unable to resolve value for ${name}`)
  }

  // Unwrap TypeScript type annotations (satisfies, as, etc.) to get the actual value
  importValue = unwrapTypeAnnotations(importValue)

  // Check if this is an inline definition
  const isInlineObject = importValue.type === 'ObjectExpression'
  const isInlineFunction =
    importValue.type === 'ArrowFunctionExpression' ||
    importValue.type === 'FunctionExpression' ||
    importValue.type === 'FunctionDeclaration'

  // ALLOW: Schemas can be inline objects (this fixes the error)
  if (propertyType === 'schema' && isInlineObject) {
    return null // Inline schema is allowed - return null to signal no import tracking needed
  }

  // ENFORCE: Server functions (execute, activate, deactivate) MUST be imported from .server.ts files
  if (propertyType === 'execute' || propertyType === 'activate' || propertyType === 'deactivate') {
    if (isInlineFunction) {
      throw new Error(
        `Server function '${name}' must be imported from a separate .server.ts file. ` +
          `Inline server functions with 'use server' are not allowed. ` +
          `Please create a .server.ts file and import the function.`
      )
    }
    if (isInlineObject) {
      throw new Error(
        `Expected '${name}' to be a function imported from a .server.ts file, but found an object.`
      )
    }
  }

  // Handle imports and re-exports
  if (importValue.type !== 'ImportBinding' && importValue.type !== 'ExportNamedDeclaration') {
    throw new Error(
      `Expected '${name}' to be imported from another file. Found ${importValue.type} instead.`
    )
  }
  const importDeclaration =
    importValue.type === 'ExportNamedDeclaration' ? importValue : importValue.parent
  const sourcePath = importDeclaration.source.value
  let absolutePath = resolveAbsolutePath(sourcePath, currPath)

  // Check if this is a .server file
  const isServerFile =
    sourcePath.endsWith('.server') ||
    sourcePath.endsWith('.server.ts') ||
    sourcePath.endsWith('.server.tsx') ||
    sourcePath.endsWith('.server.js')

  if (isServerFile) {
    // .server files are valid for execute/activate/deactivate functions
    // Validate usage: schemas should NOT come from .server files
    if (propertyType === 'schema') {
      throw new Error(
        `Schema '${name}' should not be imported from a .server file. ` +
          `Please define the schema inline in your .workflow file.`
      )
    }

    // Validate default export (required for .server files)
    if (importValue.type === 'ImportBinding') {
      const importDecl = importValue.parent
      const specifier = importDecl.specifiers.find(
        (s: ASTNode) => s.local && s.local.name === importValue.name.name
      )

      if (specifier && specifier.type !== 'ImportDefaultSpecifier') {
        throw new Error(
          `Server function '${name}' must be imported as a default export. ` +
            `Use: import ${importValue.name.name} from '${sourcePath}' ` +
            `instead of: import { ${name} } from '${sourcePath}'`
        )
      }
    }

    // Process .server file - always use 'default' as the export name
    absolutePath = resolvePathWithExtension(absolutePath, helpers.doesModuleExist) || absolutePath
    return { path: absolutePath, export: 'default' }
  }

  // Regular file - recursively follow exports through intermediate files
  const module = loadModule(sourcePath, absolutePath, helpers)

  // Determine export name (handle both default and named imports)
  let exportName = name
  if (importValue.type === 'ImportBinding') {
    const importDecl = importValue.parent
    const specifier = importDecl.specifiers.find(
      (s: ASTNode) => s.local && s.local.name === importValue.name.name
    )
    if (specifier && specifier.type === 'ImportDefaultSpecifier') {
      exportName = 'default'
    } else if (specifier && specifier.type === 'ImportSpecifier' && specifier.imported) {
      exportName = specifier.imported.name
    }
  }

  if (!module.namedExports.has(exportName)) {
    throw new Error(
      `Unable to find export '${exportName}' in module ${sourcePath}. ` +
        `Available exports: ${Array.from(module.namedExports.keys()).join(', ')}`
    )
  }

  const value = module.namedExports.get(exportName)
  const moduleScope = module.scope
  const modulePath = module.path
  if (!moduleScope) {
    throw new Error(`Unable to resolve scope for module ${sourcePath}`)
  }
  return captureImportPath(name, value, moduleScope, modulePath, helpers, propertyType)
}

/**
 * Visit a block definition and extract handler references
 */
function visitBlock(
  node: ASTNode,
  scope: Scope,
  result: Map<string, BlockModule>,
  currPath: string,
  helpers: Helpers
): void {
  if (node.type === 'Identifier') {
    let targetScope = scope
    let value = resolveIdentifierToValue(node, scope)
    let targetPath = currPath
    if (value?.type === 'ImportBinding') {
      const importDeclaration = value.parent
      const module = loadModule(importDeclaration.source.value, currPath, helpers)
      const local = value.name.name
      const specififier = importDeclaration.specifiers.find((s: ASTNode) => s.local.name === local)
      const name = (specififier?.imported).name
      if (!module.namedExports.has(name)) {
        throw new Error(
          `Unable to find named export ${name} in module ${importDeclaration.source.value}`
        )
      }
      value = module.namedExports.get(name)
      if (module.scope) {
        targetScope = module.scope
      }
      targetPath = module.path
    }
    // Unwrap TypeScript type annotations (satisfies, as, etc.)
    value = unwrapTypeAnnotations(value)

    if (!value || value.type !== 'ObjectExpression') {
      throw new Error(`Expected variable ${node.name} to have an initializer`)
    }
    visitBlock(value, targetScope, result, targetPath, helpers)
    return
  }
  if (node.type === 'ObjectExpression') {
    let id
    let execute
    let schema
    let activate
    let deactivate
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.key.type !== 'Identifier') {
        continue
      }
      const name = property.key.name
      if (name === 'id') {
        if (property.value.type !== 'Literal' || typeof property.value.value !== 'string') {
          throw new Error('Expected block id to be a string literal')
        }
        id = property.value.value
      } else if (name === 'execute') {
        // Pass 'execute' as propertyType - enforces .server.ts import
        execute = captureImportPath(name, property.value, scope, currPath, helpers, 'execute')
        // execute must be imported, so captureImportPath will never return null here
      } else if (name === 'schema') {
        // Pass 'schema' as propertyType - allows inline definitions (FIX FOR THE ERROR)
        const ref = captureImportPath(name, property.value, scope, currPath, helpers, 'schema')
        if (ref !== null) {
          // Schema is imported from another file
          schema = ref
        } else {
          // Inline schema definition - extract actual variable name for better tracking
          let exportName = 'inline_schema'
          if (property.value.type === 'Identifier') {
            exportName = property.value.name // e.g., 'sendEmailSchema'
          }
          schema = { path: currPath, export: exportName }
        }
      } else if (name === 'activate') {
        // Pass 'activate' as propertyType - enforces .server.ts import (future-proof)
        activate = captureImportPath(name, property.value, scope, currPath, helpers, 'activate')
      } else if (name === 'deactivate') {
        // Pass 'deactivate' as propertyType - enforces .server.ts import (future-proof)
        deactivate = captureImportPath(name, property.value, scope, currPath, helpers, 'deactivate')
      }
      // NOTE: 'node' and 'panel' are NOT processed here - they're bundled by the client build
    }
    if (!id || !schema) {
      throw new Error('Expected block to have id and schema properties')
    }
    result.set(id, {
      execute,
      schema,
      activate,
      deactivate,
    })
  }
}

/**
 * Find a property by name in an object expression
 */
function findProperty(obj: ASTNode, name: string, scope: Scope): ASTNode | null {
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
  if (value.type === 'Identifier') {
    const resolvedValue = resolveIdentifierToValue(value, scope)
    if (resolvedValue && resolvedValue?.type !== 'ImportBinding') {
      value = resolvedValue
    }
  }
  return value
}

/**
 * Find workflow block modules from source code
 * Parses the source and extracts block definitions from the app export
 *
 * Supports both:
 * 1. New schema-based API: app.workflow.blocks (array) and app.workflow.triggers (array)
 * 2. Legacy API: app.workflow.blocks.steps (object) for backward compatibility
 */
export function findWorkflowBlockModulesFromSource(
  source: string,
  currPath: string,
  helpers: Helpers
) {
  const result = new Map()
  try {
    const ast = parse(source, {
      range: true,
      jsx: true,
    })
    const scopeManager = analyze(ast, {
      sourceType: 'module',
    })
    const moduleScope = scopeManager.acquire(ast, true)
    if (moduleScope === null) {
      throw new Error('Expected to be able to acquire module scope')
    }
    ;(walk as any)(ast, null, {
      ExportNamedDeclaration(node: ASTNode, _context: unknown) {
        if (!node.declaration || node.declaration.type !== 'VariableDeclaration') {
          return // Just skip it, don't throw error
        }
        if (node.declaration.declarations.length !== 1) {
          throw new Error('Expected exactly one declaration per export')
        }
        const declaration = node.declaration.declarations[0]
        if (declaration.id.type !== 'Identifier' || declaration.id.name !== 'app') {
          return
        }
        const appValue = declaration.init
        if (!appValue || appValue.type !== 'ObjectExpression') {
          throw new Error('Expected app to be initialized to an object')
        }
        const workflow = findProperty(appValue, 'workflow', moduleScope)
        if (workflow?.type !== 'ObjectExpression') {
          return
        }

        // Try new schema-based API first: app.workflow.blocks (array)
        const blocksArray = findProperty(workflow, 'blocks', moduleScope)
        if (blocksArray?.type === 'ArrayExpression') {
          // New API: workflow.blocks is an array of block definitions
          for (const element of blocksArray.elements) {
            if (element) {
              visitBlock(element, moduleScope, result, currPath, helpers)
            }
          }
        } else if (blocksArray?.type === 'ObjectExpression') {
          // Legacy API: workflow.blocks.steps
          const steps = findProperty(blocksArray, 'steps', moduleScope)
          if (steps?.type === 'ArrayExpression') {
            for (const element of steps.elements) {
              if (element) {
                visitBlock(element, moduleScope, result, currPath, helpers)
              }
            }
          }
        }

        // Also check for triggers in new API: app.workflow.triggers (array)
        const triggersArray = findProperty(workflow, 'triggers', moduleScope)
        if (triggersArray?.type === 'ArrayExpression') {
          for (const element of triggersArray.elements) {
            if (element) {
              // Triggers use the same visitBlock function
              visitBlock(element, moduleScope, result, currPath, helpers)
            }
          }
        }
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errored({ code: 'WORKFLOW_BLOCK_RESOLUTION_FAILED', message })
  }
  return complete(result)
}

/**
 * Find workflow block modules from the app source directory
 * Locates the app entry point and extracts block definitions
 */
export async function findWorkflowBlockModules(srcDirAbsolute: string) {
  const appEntryPoint = await getAppEntryPoint(srcDirAbsolute)
  if (!appEntryPoint) {
    return complete(new Map())
  }
  const getModuleSource = (path: string) => {
    return fs.readFileSync(path, 'utf-8')
  }
  const doesModuleExist = (path: string) => {
    return fs.existsSync(path)
  }
  const modules = new Map()
  return findWorkflowBlockModulesFromSource(appEntryPoint.content, appEntryPoint.path, {
    getModuleSource,
    doesModuleExist,
    modules,
  })
}
