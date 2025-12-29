import path from 'path'
import { glob } from 'glob'
import { combineAsync, complete, errored, isErrored } from '../../errors.js'
import { APP_SETTINGS_FILENAME } from '../../constants/settings-files.js'
import { USE_SETTINGS } from '../../env.js'

/**
 * Workflow block handler data
 */
interface WorkflowHandlerData {
  path: string
  export: string
}

/**
 * Map of workflow block handlers
 */
type WorkflowBlockModules = Map<string, Record<string, WorkflowHandlerData | undefined>>

/**
 * Logger function
 */
type LogFunction = (message: string) => void

/**
 * Finds server function modules matching a specific pattern in a directory.
 *
 * This utility scans for files with a specific naming pattern (e.g., `*.server.js`, `*.webhook.ts`)
 * and returns their paths relative to the provided directory.
 *
 * @param cwd - The current working directory to search in
 * @param pattern - The file pattern to match (e.g., 'server', 'webhook', 'event')
 *
 * @returns A Result containing an array of matching file paths or an error
 *
 * @example
 * // Find all server function modules
 * const result = await findServerFunctionModules('/app/src', 'server')
 * if (!isErrored(result)) {
 *   console.log(result.value) // ['user-handler.server.ts', 'auth.server.js']
 * }
 *
 * @example
 * // Find webhook modules
 * const webhooks = await findServerFunctionModules('/app/webhooks', 'webhook')
 */
async function findServerFunctionModules(cwd: string, pattern: string) {
  try {
    return complete(await glob(`**/*.${pattern}.{js,ts}`, { nodir: true, cwd }))
  } catch (error) {
    return errored({
      code: 'ERROR_FINDING_SERVER_FUNCTION_MODULES',
      path: cwd,
      pattern,
      cause: error,
    })
  }
}

/**
 * Generates a server-side entry point file that dynamically imports and registers all
 * server functions, webhooks, events, and workflow block handlers.
 *
 * This function scans multiple directories for specific file patterns:
 * - `*.server.{js,ts}` files in the source directory for server functions
 * - `*.webhook.{js,ts}` files in the webhooks directory for webhook handlers
 * - `*.event.{js,ts}` files in the events directory for event handlers
 * - Workflow block modules from the provided workflowBlockModules map
 *
 * It then generates JavaScript code that:
 * 1. Creates module registries (Maps) for each type of handler
 * 2. Registers dynamic imports for all discovered modules
 * 3. Provides runtime loader functions (stdin_default, stdin_webhooks_default, etc.)
 * 4. Optionally initializes app settings schema if USE_SETTINGS is enabled
 *
 * The generated code is designed to be bundled and executed in a server environment
 * where modules can be dynamically loaded based on their hash/id at runtime.
 *
 * @param params - Configuration parameters for server entry generation
 * @param params.appDirAbsolute - Absolute path to the application root directory
 * @param params.srcDirAbsolute - Absolute path to the source directory containing *.server.{js,ts} files
 * @param params.webhooksDirAbsolute - Absolute path to the webhooks directory containing *.webhook.{js,ts} files
 * @param params.eventDirAbsolute - Absolute path to the events directory containing *.event.{js,ts} files
 * @param params.workflowBlockModules - Map of workflow block IDs to their handler metadata (path and export name)
 * @param params.log - Optional logging function for debug output
 *
 * @returns A Result containing the generated JavaScript code as a string or an error
 *
 * @example
 * // Basic usage: Generate server entry for a workflow app
 * const result = await generateServerEntry({
 *   appDirAbsolute: '/app',
 *   srcDirAbsolute: '/app/src',
 *   webhooksDirAbsolute: '/app/webhooks',
 *   eventDirAbsolute: '/app/events',
 *   workflowBlockModules: new Map(),
 *   log: console.log
 * })
 *
 * if (!isErrored(result)) {
 *   console.log('Generated entry code:', result.value)
 * }
 *
 * @example
 * // With workflow block modules
 * const workflowBlocks = new Map([
 *   ['email-trigger', {
 *     schema: { path: 'blocks/email-trigger.ts', export: 'schema' },
 *     handler: { path: 'blocks/email-trigger.ts', export: 'handler' }
 *   }],
 *   ['send-reply', {
 *     handler: { path: 'blocks/send-reply.ts', export: 'execute' }
 *   }]
 * ])
 *
 * const result = await generateServerEntry({
 *   appDirAbsolute: '/project/workflows',
 *   srcDirAbsolute: '/project/workflows/src',
 *   webhooksDirAbsolute: '/project/workflows/webhooks',
 *   eventDirAbsolute: '/project/workflows/events',
 *   workflowBlockModules: workflowBlocks
 * })
 *
 * @example
 * // Error handling
 * const result = await generateServerEntry({
 *   appDirAbsolute: '/app',
 *   srcDirAbsolute: '/app/src',
 *   webhooksDirAbsolute: '/app/webhooks',
 *   eventDirAbsolute: '/app/events',
 *   workflowBlockModules: new Map()
 * })
 *
 * if (isErrored(result)) {
 *   if (result.error.code === 'ERROR_FINDING_SERVER_FUNCTION_MODULES') {
 *     console.error('Failed to find modules in:', result.error.path)
 *     console.error('Pattern:', result.error.pattern)
 *   }
 * }
 *
 * @example
 * // Using in a build pipeline
 * import fs from 'fs/promises'
 *
 * async function buildServerBundle(appDir: string) {
 *   const workflowBlocks = new Map()
 *
 *   const entryCode = await generateServerEntry({
 *     appDirAbsolute: appDir,
 *     srcDirAbsolute: `${appDir}/src`,
 *     webhooksDirAbsolute: `${appDir}/webhooks`,
 *     eventDirAbsolute: `${appDir}/events`,
 *     workflowBlockModules: workflowBlocks,
 *     log: (msg) => console.log('[Build]', msg)
 *   })
 *
 *   if (isErrored(entryCode)) {
 *     throw new Error(`Failed to generate entry: ${entryCode.error.code}`)
 *   }
 *
 *   // Write generated entry code to disk
 *   await fs.writeFile(`${appDir}/.auxx/server-entry.js`, entryCode.value)
 *
 *   // Now bundle with esbuild or similar
 *   // ...
 * }
 */
export async function generateServerEntry({
  appDirAbsolute,
  srcDirAbsolute,
  webhooksDirAbsolute,
  eventDirAbsolute,
  workflowBlockModules,
  log,
}: {
  appDirAbsolute: string
  srcDirAbsolute: string
  webhooksDirAbsolute: string
  eventDirAbsolute: string
  workflowBlockModules: WorkflowBlockModules
  log?: LogFunction
}) {
  const pathsResult = await combineAsync({
    serverFunctionConcretePaths: findServerFunctionModules(srcDirAbsolute, 'server'),
    webhookConcretePaths: findServerFunctionModules(webhooksDirAbsolute, 'webhook'),
    eventConcretePaths: findServerFunctionModules(eventDirAbsolute, 'event'),
  })
  if (isErrored(pathsResult)) {
    return pathsResult
  }
  const { serverFunctionConcretePaths, webhookConcretePaths, eventConcretePaths } =
    pathsResult.value
  const serverFunctionModules = serverFunctionConcretePaths.map((path) => ({
    path,
    hash: path.replace(/\.(js|ts)$/, ''),
  }))
  const webhookModules = webhookConcretePaths.map((path) => ({
    path,
    id: path.replace(/\.webhook\.(js|ts)$/, ''),
  }))
  const eventModules = eventConcretePaths.map((path) => ({
    path,
    id: path.replace(/\.event\.(js|ts)$/, ''),
  }))
  for (const module of serverFunctionModules) {
    log?.(`🔎 Found server module "${module.path}"`)
  }
  const initSettingsJS = `
        import appSettingsSchema from ${JSON.stringify(path.join(srcDirAbsolute, APP_SETTINGS_FILENAME))}

        registerSettingsSchema(appSettingsSchema)
    `
  return complete(`
        ${USE_SETTINGS ? initSettingsJS : ''}

        const modules = new Map()
        const webhookModules = new Map()
        const eventModules = new Map()
        const workflowModules = new Map()
    
        ${serverFunctionModules
          .map(
            (module) =>
              `modules.set("${module.hash}", () => import(${JSON.stringify(path.join(srcDirAbsolute, module.path))}))`
          )
          .join('\n')}

        ${webhookModules
          .map(
            (module) =>
              `webhookModules.set("${module.id}", () => import(${JSON.stringify(path.join(webhooksDirAbsolute, module.path))}))`
          )
          .join('\n')}

        ${eventModules
          .map(
            (module) =>
              `eventModules.set("${module.id}", () => import(${JSON.stringify(path.join(eventDirAbsolute, module.path))}))`
          )
          .join('\n')}

        ${[...workflowBlockModules.entries()]
          .map(
            ([blockId, handlers]) => `workflowModules.set(
                        ${JSON.stringify(blockId)},
                        {
                        ${[...Object.entries(handlers)]
                          .map(([handler, data]) =>
                            data
                              ? `${JSON.stringify(handler)}: {
                                        module: () => import(${JSON.stringify(path.join(appDirAbsolute, data.path))}),
                                        export: ${JSON.stringify(data.export)}
                                    },`
                              : ''
                          )
                          .join('\n')}
                        }
                    )`
          )
          .join('\n')}

        // Build __AUXX_WORKFLOW_BLOCKS__ for Lambda executor compatibility
        const __AUXX_WORKFLOW_BLOCKS__ = {};

        for (const [blockId, handlers] of workflowModules.entries()) {
            __AUXX_WORKFLOW_BLOCKS__[blockId] = {
                execute: async (input) => {
                    const executeHandler = handlers.execute;
                    if (!executeHandler) {
                        throw new Error(\`No execute handler for block \${blockId}\`);
                    }
                    const module = await executeHandler.module();
                    const func = module[executeHandler.export];
                    if (!func) {
                        throw new Error(\`Execute export not found in block \${blockId}\`);
                    }
                    if (typeof func !== "function") {
                        throw new Error(\`Execute export in block \${blockId} is not a function\`);
                    }
                    return await func(input);
                }
            };
        }

        var stdin_default;
        var stdin_webhooks_default;
        var stdin_events_default;
        var stdin_workflow_block_handlers_default;

        function main() {
            stdin_default = async function(moduleHash, args) {
                const module = modules.get(moduleHash)

                if (!module) {
                    throw new Error(\`Module \${moduleHash} not found\`)
                }

                const func = (await module()).default

                if (!func) {
                    throw new Error(\`Default export not found in module \${moduleHash}\`)
                }

                if (typeof func !== "function") {
                    throw new Error(\`\${moduleHash} does not export a function\`)
                }

                return func(...args)
            }

            stdin_webhooks_default = async function(webhookModuleId, args) {
                const module = webhookModules.get(webhookModuleId)

                if (!module) {
                    throw new Error(\`Webhook handler not found: \${webhookModuleId}\`)
                }

                const func = (await module()).default

                if (!func) {
                    throw new Error(\`Default export not found in module \${webhookModuleId}\`)
                }

                if (typeof func !== "function") {
                    throw new Error(\`\${webhookModuleId} does not export a function\`)
                }

                return func(...args)
            }

            stdin_events_default = async function(eventModuleId, args) {
                const module = eventModules.get(eventModuleId)

                if (!module) {
                    throw new Error("Event handler not found")
                }

                const func = (await module()).default

                if (!func) {
                    throw new Error(\`Default export not found in module \${eventModuleId}\`)
                }

                if (typeof func !== "function") {
                    throw new Error(\`\${eventModuleId} does not export a function\`)
                }

                return func(...args)
            }

            stdin_workflow_block_handlers_default = async function(blockId, handler, args) {
                const modules = workflowModules.get(blockId)

                if (!modules) {
                    throw new Error("Workflow block modules not found")
                }

                const handlerData = modules[handler]

                if (!handlerData) {
                    throw new Error(\`Workflow block module \${JSON.stringify(handler)} not found\`)
                }

                if (handler === "schema") {
                    const schema = (await handlerData.module())[handlerData.export]

                    if (!schema) {
                        throw new Error(\`"\${handler}\" export not found in module \${JSON.stringify(blockId)}\`)
                    }

                    return schema
                }

                const func = (await handlerData.module())[handlerData.export]

                if (!func) {
                    throw new Error(\`"\${handler}\" export not found in module \${JSON.stringify(blockId)}\`)
                }

                if (typeof func !== "function") {
                   throw new Error(\`"\${handler}\" export in module \${JSON.stringify(blockId)} is not a function\`)
                }

                return args ? func(...args) : func()
            }
        }

        main()
`)
}
