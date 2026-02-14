// packages/sdk/src/build/proxy-server-modules-plugin.ts

import type { OnLoadArgs, OnLoadResult, OnResolveArgs, Plugin, PluginBuild } from 'esbuild'
import path from 'path'

/**
 * Builds the proxy module source that forwards calls to `runServerFunction` using the provided hash.
 * @param moduleHash Unique hash that identifies the server module to execute.
 * @returns JavaScript source for a proxy module that invokes the server function.
 */
function getServerModuleProxy(moduleHash: string): string {
  return `
export default async function(...args) {
    return runServerFunction(${JSON.stringify(moduleHash)}, args)
}`
}

/**
 * Constant namespace identifier for the esbuild plugin.
 */
const PLUGIN_NAME = 'proxy-server-modules-plugin'

/**
 * Data stored on esbuild's plugin data bag so the load hook knows the module hash.
 */
interface ProxyPluginData {
  moduleHash: string
}

/**
 * Creates an esbuild plugin that turns `.server` modules into client proxies which delegate execution to the server runtime.
 * @param params.srcDir Absolute source directory used to compute stable module hashes.
 * @returns Configured esbuild plugin that rewrites `.server` imports to proxy modules.
 */
export function proxyServerModulesPlugin({ srcDir }: { srcDir: string }): Plugin {
  return {
    name: PLUGIN_NAME,
    setup(build: PluginBuild) {
      build.onResolve({ filter: /\.server$/ }, (args: OnResolveArgs) => {
        const filePath = path.relative(srcDir, path.resolve(args.resolveDir, args.path))
        return {
          path: args.path,
          namespace: PLUGIN_NAME,
          pluginData: { moduleHash: filePath } as ProxyPluginData,
        }
      })
      build.onLoad(
        { filter: /.*/, namespace: PLUGIN_NAME },
        async (args: OnLoadArgs): Promise<OnLoadResult> => {
          const pluginData = args.pluginData as ProxyPluginData
          return {
            contents: getServerModuleProxy(pluginData.moduleHash),
            loader: 'js',
          }
        }
      )
    },
  }
}
