// packages/sdk/src/build/server/find-tool-server-modules.ts

import fs from 'node:fs'
import { parse } from '@typescript-eslint/parser'
import type { Scope } from '@typescript-eslint/scope-manager'
import { analyze } from '@typescript-eslint/scope-manager'
import { walk } from 'zimmerframe'
import { complete, errored } from '../../errors.js'
import { getAppEntryPoint } from '../../util/get-app-entry-point.js'

/**
 * Build-time scanner for tool server modules — mirrors
 * `find-workflow-block-server-modules.ts`. Walks `app.tools[].execute`
 * and enforces that executors are default-imported from a `.server.ts` file.
 *
 * Produces a `ToolModule` map keyed by tool id, consumed by
 * `generate-server-entry.ts` to emit the `__AUXX_TOOLS__` registry the
 * lambda's unified `tool-executor.ts` looks up at run time.
 *
 * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §5.2.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = any

interface HandlerRef {
  path: string
  export: string
}

export interface ToolModule {
  execute?: HandlerRef | null
}

interface ImportBinding {
  type: 'ImportBinding'
  parent: ASTNode
  name: ASTNode
}

interface ModuleInfo {
  content: string
  ast: ASTNode
  scope: Scope | null
  namedExports: Map<string, ASTNode | ImportBinding>
  path: string
}

interface Helpers {
  getModuleSource: (path: string) => string
  doesModuleExist: (path: string) => boolean
  modules: Map<string, ModuleInfo>
}

function checkPath(path: string, doesModuleExist: (path: string) => boolean): string | null {
  return doesModuleExist(path) ? path : null
}

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

function resolveAbsolutePath(sourcePath: string, currPath: string): string {
  if (sourcePath.startsWith('.')) {
    const currDir = currPath.split('/').slice(0, -1).join('/')
    const combinedPath = currDir + '/' + sourcePath
    const parts = combinedPath.split('/')
    const resolvedParts: string[] = []
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
  if (!def) return null
  if (def.node.type === 'VariableDeclarator') return def.node.init
  if (def.type === 'ImportBinding') return def as ImportBinding
  return null
}

function loadModule(sourcePath: string, currPath: string, helpers: Helpers): ModuleInfo {
  const absolutePath = resolveAbsolutePath(sourcePath, currPath)
  const fullPath = resolvePathWithExtension(absolutePath, helpers.doesModuleExist)
  if (!fullPath) {
    throw new Error(`Unable to resolve path for module ${sourcePath} from ${currPath}`)
  }
  if (helpers.modules.has(fullPath)) {
    return helpers.modules.get(fullPath)!
  }
  const content = helpers.getModuleSource(fullPath)
  const ast = parse(content, { range: true, jsx: true })
  const scopeManager = analyze(ast, { sourceType: 'module' })
  const moduleScope = scopeManager.acquire(ast, true)
  const namedExports = new Map<string, ASTNode | ImportBinding>()
  const module: ModuleInfo = { content, ast, scope: moduleScope, namedExports, path: fullPath }
  helpers.modules.set(fullPath, module)
  ;(walk as any)(ast, null, {
    ExportNamedDeclaration(node: ASTNode) {
      if (
        node.declaration?.type === 'VariableDeclaration' &&
        node.declaration.declarations.length === 1 &&
        node.declaration.declarations[0].type === 'VariableDeclarator' &&
        node.declaration.declarations[0].id.type === 'Identifier'
      ) {
        const declaration = node.declaration.declarations[0]
        namedExports.set(declaration.id.name, declaration.init)
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
              if (resolved) namedExports.set(specifier.exported.name, resolved)
            }
          }
        }
      }
    },
    ExportDefaultDeclaration(node: ASTNode) {
      if (node.declaration) {
        if (
          node.declaration.type === 'FunctionDeclaration' ||
          node.declaration.type === 'ArrowFunctionExpression' ||
          node.declaration.type === 'FunctionExpression'
        ) {
          namedExports.set('default', node.declaration)
        } else if (node.declaration.type === 'Identifier' && moduleScope) {
          const resolved = resolveIdentifierToValue(node.declaration, moduleScope)
          if (resolved) namedExports.set('default', resolved)
        }
      }
    },
  })
  return module
}

/**
 * Capture an import reference for the `execute` property. Enforces:
 *  - Not an inline function (must live in a `.server.ts` file)
 *  - Default-imported from a `.server.ts` file
 */
function captureExecuteRef(
  toolId: string,
  node: ASTNode,
  scope: Scope,
  currPath: string,
  helpers: Helpers
): HandlerRef {
  let importValue: ASTNode | ImportBinding | null =
    node.type === 'Identifier' ? resolveIdentifierToValue(node, scope) : node
  if (!importValue) {
    throw new Error(`Tool '${toolId}': unable to resolve 'execute'`)
  }
  importValue = unwrapTypeAnnotations(importValue)

  const isInlineFunction =
    importValue.type === 'ArrowFunctionExpression' ||
    importValue.type === 'FunctionExpression' ||
    importValue.type === 'FunctionDeclaration'

  if (isInlineFunction) {
    throw new Error(
      `Tool '${toolId}': 'execute' must be imported from a separate .server.ts file. ` +
        `Inline server functions are not allowed.`
    )
  }

  if (importValue.type !== 'ImportBinding' && importValue.type !== 'ExportNamedDeclaration') {
    throw new Error(
      `Tool '${toolId}': 'execute' must be imported from another file. Found ${importValue.type}.`
    )
  }

  const importDeclaration =
    importValue.type === 'ExportNamedDeclaration' ? importValue : importValue.parent
  const sourcePath: string = importDeclaration.source.value
  const isServerFile =
    sourcePath.endsWith('.server') ||
    sourcePath.endsWith('.server.ts') ||
    sourcePath.endsWith('.server.tsx') ||
    sourcePath.endsWith('.server.js')

  if (!isServerFile) {
    throw new Error(
      `Tool '${toolId}': 'execute' must be imported from a .server.ts file (got '${sourcePath}').`
    )
  }

  if (importValue.type === 'ImportBinding') {
    const specifier = importDeclaration.specifiers.find(
      (s: ASTNode) => s.local && s.local.name === (importValue as ImportBinding).name.name
    )
    if (specifier && specifier.type !== 'ImportDefaultSpecifier') {
      throw new Error(
        `Tool '${toolId}': 'execute' must be imported as a default export from '${sourcePath}'.`
      )
    }
  }

  let absolutePath = resolveAbsolutePath(sourcePath, currPath)
  absolutePath = resolvePathWithExtension(absolutePath, helpers.doesModuleExist) || absolutePath
  return { path: absolutePath, export: 'default' }
}

function visitTool(
  node: ASTNode,
  scope: Scope,
  result: Map<string, ToolModule>,
  currPath: string,
  helpers: Helpers
): void {
  if (node.type === 'Identifier') {
    let targetScope = scope
    let value: ASTNode | ImportBinding | null = resolveIdentifierToValue(node, scope)
    let targetPath = currPath
    if (value?.type === 'ImportBinding') {
      const importDeclaration = (value as ImportBinding).parent
      const module = loadModule(importDeclaration.source.value, currPath, helpers)
      const local = (value as ImportBinding).name.name
      const specifier = importDeclaration.specifiers.find(
        (s: ASTNode) => s.local && s.local.name === local
      )
      const name = specifier?.imported?.name ?? 'default'
      if (!module.namedExports.has(name)) {
        throw new Error(
          `Unable to find named export ${name} in module ${importDeclaration.source.value}`
        )
      }
      value = module.namedExports.get(name) ?? null
      if (module.scope) targetScope = module.scope
      targetPath = module.path
    }
    value = value ? unwrapTypeAnnotations(value) : null

    if (!value) {
      throw new Error(`Tool ${node.name}: expected initializer`)
    }
    // `defineTool({...})` call expressions resolve to their argument.
    if (value.type === 'CallExpression') {
      visitTool(value.arguments[0], targetScope, result, targetPath, helpers)
      return
    }
    if (value.type !== 'ObjectExpression') {
      throw new Error(`Tool ${node.name}: expected ObjectExpression, got ${value.type}`)
    }
    visitTool(value, targetScope, result, targetPath, helpers)
    return
  }
  // `defineTool({...})` — unwrap to its first argument.
  if (node.type === 'CallExpression') {
    visitTool(node.arguments[0], scope, result, currPath, helpers)
    return
  }
  if (node.type === 'ObjectExpression') {
    let id: string | undefined
    let execute: HandlerRef | null = null
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.key.type !== 'Identifier') continue
      const name = property.key.name
      if (name === 'id') {
        if (property.value.type !== 'Literal' || typeof property.value.value !== 'string') {
          throw new Error(`Tool: 'id' must be a string literal`)
        }
        id = property.value.value
      } else if (name === 'execute') {
        execute = captureExecuteRef(id ?? '<unknown>', property.value, scope, currPath, helpers)
      }
    }
    if (!id) throw new Error(`Tool: missing 'id'`)
    if (!execute) throw new Error(`Tool '${id}': missing 'execute'`)
    result.set(id, { execute })
  }
}

function findProperty(obj: ASTNode, name: string, scope: Scope): ASTNode | null {
  const property = obj.properties.find(
    (p: ASTNode) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === name
  )
  if (!property) return null
  let value = property.value
  if (value.type === 'Identifier') {
    const resolvedValue = resolveIdentifierToValue(value, scope)
    if (resolvedValue && resolvedValue.type !== 'ImportBinding') value = resolvedValue
  }
  return value
}

/**
 * Parse the app entry source and extract `app.tools[].execute` module
 * references. Returns a map of toolId → ToolModule.
 */
export function findToolModulesFromSource(source: string, currPath: string, helpers: Helpers) {
  const result = new Map<string, ToolModule>()
  try {
    const ast = parse(source, { range: true, jsx: true })
    const scopeManager = analyze(ast, { sourceType: 'module' })
    const moduleScope = scopeManager.acquire(ast, true)
    if (moduleScope === null) {
      throw new Error('Expected to be able to acquire module scope')
    }
    ;(walk as any)(ast, null, {
      ExportNamedDeclaration(node: ASTNode) {
        if (!node.declaration || node.declaration.type !== 'VariableDeclaration') return
        if (node.declaration.declarations.length !== 1) return
        const declaration = node.declaration.declarations[0]
        if (declaration.id.type !== 'Identifier' || declaration.id.name !== 'app') return
        const appValue = declaration.init
        if (!appValue || appValue.type !== 'ObjectExpression') return

        const tools = findProperty(appValue, 'tools', moduleScope)
        if (tools?.type !== 'ArrayExpression') return

        for (const element of tools.elements) {
          if (element) visitTool(element, moduleScope, result, currPath, helpers)
        }
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errored({ code: 'TOOL_RESOLUTION_FAILED', message })
  }
  return complete(result)
}

/**
 * Discover and parse tool modules from the app source directory.
 */
export async function findToolModules(srcDirAbsolute: string) {
  const appEntryPoint = await getAppEntryPoint(srcDirAbsolute)
  if (!appEntryPoint) {
    return complete(new Map<string, ToolModule>())
  }
  return findToolModulesFromSource(appEntryPoint.content, appEntryPoint.path, {
    getModuleSource: (p) => fs.readFileSync(p, 'utf-8'),
    doesModuleExist: (p) => fs.existsSync(p),
    modules: new Map<string, ModuleInfo>(),
  })
}

/** A data connector server module — `{ execute: HandlerRef }` per connector id. */
export interface DataConnectorModule {
  execute?: HandlerRef | null
}

/**
 * Parse the app entry source and extract `app.dataConnectors[].execute` module
 * references. Reuses the same `id` + `.server.ts execute` discipline as tools
 * (`visitTool`), keyed by connector id. Consumed by `generate-server-entry.ts`
 * to emit the `__AUXX_DATA_CONNECTORS__` registry the lambda's
 * `data-connector-executor.ts` looks up at run time. See
 * docs/app-fields-and-entities-guide.md.
 */
export function findDataConnectorModulesFromSource(
  source: string,
  currPath: string,
  helpers: Helpers
) {
  const result = new Map<string, DataConnectorModule>()
  try {
    const ast = parse(source, { range: true, jsx: true })
    const scopeManager = analyze(ast, { sourceType: 'module' })
    const moduleScope = scopeManager.acquire(ast, true)
    if (moduleScope === null) {
      throw new Error('Expected to be able to acquire module scope')
    }
    ;(walk as any)(ast, null, {
      ExportNamedDeclaration(node: ASTNode) {
        if (!node.declaration || node.declaration.type !== 'VariableDeclaration') return
        if (node.declaration.declarations.length !== 1) return
        const declaration = node.declaration.declarations[0]
        if (declaration.id.type !== 'Identifier' || declaration.id.name !== 'app') return
        const appValue = declaration.init
        if (!appValue || appValue.type !== 'ObjectExpression') return

        const connectors = findProperty(appValue, 'dataConnectors', moduleScope)
        if (connectors?.type !== 'ArrayExpression') return

        for (const element of connectors.elements) {
          if (element) visitTool(element, moduleScope, result, currPath, helpers)
        }
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errored({ code: 'DATA_CONNECTOR_RESOLUTION_FAILED', message })
  }
  return complete(result)
}

/**
 * Discover and parse data connector modules from the app source directory.
 */
export async function findDataConnectorModules(srcDirAbsolute: string) {
  const appEntryPoint = await getAppEntryPoint(srcDirAbsolute)
  if (!appEntryPoint) {
    return complete(new Map<string, DataConnectorModule>())
  }
  return findDataConnectorModulesFromSource(appEntryPoint.content, appEntryPoint.path, {
    getModuleSource: (p) => fs.readFileSync(p, 'utf-8'),
    doesModuleExist: (p) => fs.existsSync(p),
    modules: new Map<string, ModuleInfo>(),
  })
}
