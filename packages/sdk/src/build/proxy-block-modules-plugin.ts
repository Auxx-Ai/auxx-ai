// packages/sdk/src/build/proxy-block-modules-plugin.ts

/**
 * @file Esbuild plugin that blocks workflow .block file imports (defensive code).
 *
 * NOTE: This plugin is DEFENSIVE CODE. The .block file pattern is NOT used in the current
 * architecture. The actual pattern is:
 * - .workflow.tsx files for block definitions and schemas
 * - .server.ts files for server-side execute functions
 *
 * This plugin intercepts any accidental imports of `.block` files during client-side builds
 * and replaces them with proxy implementations that throw clear error messages. This prevents
 * developers from accidentally using an unsupported file pattern.
 *
 * The plugin works by:
 * 1. Intercepting `.block` module resolution during the build process
 * 2. Generating proxy code that throws descriptive errors
 * 3. Each proxy function/property throws when accessed, guiding developers to the correct pattern
 *
 * This is kept for backward compatibility and as a safety net in case .block files are
 * accidentally created.
 */

import path from 'path'
import type { Plugin, PluginBuild, OnResolveArgs, OnLoadArgs, OnLoadResult } from 'esbuild'

/**
 * Reference to a handler function with its file path and export name.
 * Used to track where block handlers (execute, activate, deactivate) are defined.
 */
interface HandlerRef {
  /** Relative file path where the handler is exported from */
  path: string
  /** The export name (e.g., 'execute', 'default', or a custom name) */
  export: string
}

/**
 * Complete structure of a workflow block module containing all possible handlers.
 * Each handler is optional and references a function that should only run on the server.
 */
interface BlockModule {
  /** Handler function that executes the main block logic */
  execute?: HandlerRef
  /** Schema definition for the block's configuration and data structure */
  schema?: HandlerRef
  /** Handler called when the block is activated/enabled */
  activate?: HandlerRef
  /** Handler called when the block is deactivated/disabled */
  deactivate?: HandlerRef
}

/**
 * Mutable reference wrapper for the workflow block modules map.
 * Uses a ref pattern to allow the map to be updated between builds while
 * maintaining the same reference for the esbuild plugin closure.
 */
interface WorkflowBlockModulesRef {
  /** Current map of block ID to block module structure */
  current: Map<string, BlockModule>
}

/**
 * Data structure passed between the resolve and load hooks via esbuild's plugin data.
 * Contains the normalized module path needed to generate the correct proxy exports.
 */
interface ProxyPluginData {
  /** Relative path to the module being proxied, with .ts extension added */
  modulePath: string
}

/**
 * Generates proxy JavaScript code for a block module's exports.
 *
 * This function examines all workflow blocks to find exports that match the given
 * module path, then generates proxy implementations for each:
 *
 * - **Function exports** (execute, activate, deactivate): Replaced with async functions
 *   that throw an error when called
 * - **Schema exports**: Replaced with a Proxy object that throws an error when any
 *   property is accessed
 *
 * For default exports, unique variable names are generated to avoid conflicts.
 *
 * @param modulePath - Relative path to the module being proxied (e.g., 'blocks/myBlock.ts')
 * @param workflowBlockModulesRef - Reference to the current workflow block modules map
 * @returns Generated JavaScript code as a string containing all proxy exports
 *
 * @example
 * // For a block with execute and schema exports, generates:
 * ```javascript
 * export async function execute() {
 *   throw new Error("Exports from *.block.ts files cannot be called from the client.")
 * }
 * const schema_0 = new Proxy({}, {
 *   get() {
 *     throw new Error("Exports from *.block.ts files cannot be called from the client.");
 *   }
 * });
 * export default schema_0;
 * ```
 */
function getBlockModuleProxy(modulePath: string, workflowBlockModulesRef: WorkflowBlockModulesRef): string {
  let counter = 0
  const exports = new Map<string, string>()
  for (const {
    execute,
    schema,
    activate,
    deactivate,
  } of workflowBlockModulesRef.current.values()) {
    for (const handler of [execute, activate, deactivate]) {
      if (!handler || handler.path !== modulePath) {
        continue
      }
      if (handler.export === 'default') {
        exports.set(
          'default',
          `export default async function() {
    throw new Error("Imports from .block files are not supported. Please use .workflow files for block definitions and .server files for execute functions.")
}`
        )
      } else {
        exports.set(
          handler.export,
          `export async function ${handler.export}() {
    throw new Error("Imports from .block files are not supported. Please use .workflow files for block definitions and .server files for execute functions.")
}`
        )
      }
    }
    if (schema && schema.path === modulePath) {
      if (schema.export === 'default') {
        let name
        do {
          name = `schema_${counter++}`
        } while (!exports.has(name))
        exports.set(
          'default',
          `const ${name} = new Proxy({}, {
    get() {
        throw new Error("Imports from .block files are not supported. Please use .workflow files for block definitions and .server files for execute functions.");
    }
});

export default ${name};`
        )
      } else {
        exports.set(
          schema.export,
          `export const ${schema.export} = new Proxy({}, {
    get() {
        throw new Error("Imports from .block files are not supported. Please use .workflow files for block definitions and .server files for execute functions.");
    }
});`
        )
      }
    }
  }
  return [...exports.values()].join('\n')
}

/**
 * Plugin name constant used for esbuild namespace identification.
 * This namespace is used to isolate the plugin's virtual modules from real file system modules.
 */
const PLUGIN_NAME = 'proxy-block-modules-plugin'

/**
 * Creates an esbuild plugin that intercepts `.block` module imports and replaces them with
 * client-safe proxy implementations.
 *
 * This plugin is essential for the Auxx workflow system, which allows developers to define
 * server-only block handlers in `.block.ts` files. When building the client bundle, this
 * plugin ensures that:
 *
 * 1. `.block` imports are resolved to a special namespace
 * 2. The actual module content is replaced with proxy code
 * 3. Any attempt to call or access block exports from client code throws a clear error
 *
 * The plugin operates in two phases:
 *
 * **Resolve Phase**: Intercepts module paths ending with `.block` and marks them for
 * special handling by assigning them to the plugin's namespace. The module path is
 * normalized relative to the app directory and stored for the load phase.
 *
 * **Load Phase**: Generates proxy JavaScript code that matches the original module's
 * exports but throws runtime errors when accessed. This maintains type safety while
 * preventing server code execution on the client.
 *
 * @param params - Plugin configuration options
 * @param params.appDir - Absolute path to the app directory, used to compute relative module paths
 * @param params.workflowBlockModulesRef - Mutable reference to the workflow blocks map,
 *   updated between rebuilds to track which exports need proxying
 * @returns Configured esbuild plugin with resolve and load hooks
 *
 * @example
 * ```typescript
 * import { proxyBlockModulesPlugin } from './proxy-block-modules-plugin'
 *
 * const buildConfig = {
 *   plugins: [
 *     proxyBlockModulesPlugin({
 *       appDir: '/absolute/path/to/app',
 *       workflowBlockModulesRef: { current: new Map() }
 *     })
 *   ]
 * }
 * ```
 *
 * @see {@link getBlockModuleProxy} for details on proxy code generation
 */
export function proxyBlockModulesPlugin({
  appDir,
  workflowBlockModulesRef,
}: {
  appDir: string
  workflowBlockModulesRef: WorkflowBlockModulesRef
}): Plugin {
  return {
    name: PLUGIN_NAME,
    setup(build: PluginBuild) {
      build.onResolve({ filter: /\.block$/ }, (args: OnResolveArgs) => {
        const modulePath = path.relative(appDir, path.resolve(args.resolveDir, args.path)) + '.ts'
        return {
          path: args.path,
          namespace: PLUGIN_NAME,
          pluginData: { modulePath } as ProxyPluginData,
        }
      })
      build.onLoad(
        { filter: /.*/, namespace: PLUGIN_NAME },
        async (args: OnLoadArgs): Promise<OnLoadResult> => {
          const pluginData = args.pluginData as ProxyPluginData
          return {
            contents: getBlockModuleProxy(pluginData.modulePath, workflowBlockModulesRef),
            loader: 'js',
          }
        },
      )
    },
  }
}
