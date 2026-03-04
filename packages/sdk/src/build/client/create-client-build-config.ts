import globalExternals from '@fal-works/esbuild-plugin-global-externals'
import type { BuildOptions } from 'esbuild'
import { proxyBlockModulesPlugin } from '../proxy-block-modules-plugin.js'
import { proxyServerModulesPlugin } from '../proxy-server-modules-plugin.js'

/**
 * Creates an esbuild configuration for building client-side Auxx workflow code.
 *
 * This function generates a browser-targeted build configuration that:
 * - Bundles workflow client code into an IIFE (Immediately Invoked Function Expression)
 * - Externalizes React to use the global React instance instead of bundling it
 * - Externalizes Auxx SDK modules to use runtime-provided instances
 * - Proxies server-side modules to prevent them from being included in client bundles
 * - Proxies workflow block modules to enable dynamic block loading
 *
 * The configuration is designed for building workflow extensions that run in the
 * Auxx client environment where React and SDK modules are already available globally.
 *
 * @param params - Configuration parameters for the client build
 * @param params.appDir - Absolute path to the application directory containing workflow code
 * @param params.srcDir - Absolute path to the source directory containing workflow modules
 * @param params.entryPoint - Absolute path to the entry point file to bundle
 * @param params.workflowBlockModulesRef - Reference object containing workflow block module metadata for dynamic resolution
 *
 * @returns An esbuild configuration object ready to be passed to esbuild.build()
 *
 * @example
 * // Basic usage: Build a workflow client bundle
 * import esbuild from 'esbuild'
 *
 * const config = createClientBuildConfig({
 *   appDir: '/project/workflows',
 *   srcDir: '/project/workflows/src',
 *   entryPoint: '/project/workflows/src/index.tsx',
 *   workflowBlockModulesRef: { blocks: [] }
 * })
 *
 * await esbuild.build(config)
 *
 * @example
 * // Building with custom output options
 * import esbuild from 'esbuild'
 *
 * const workflowBlockModules = {
 *   blocks: [
 *     { id: 'email-trigger', path: './blocks/email-trigger.tsx' },
 *     { id: 'send-reply', path: './blocks/send-reply.tsx' }
 *   ]
 * }
 *
 * const config = createClientBuildConfig({
 *   appDir: '/app/workflows',
 *   srcDir: '/app/workflows/src',
 *   entryPoint: '/app/workflows/src/client.tsx',
 *   workflowBlockModulesRef: workflowBlockModules
 * })
 *
 * await esbuild.build({
 *   ...config,
 *   outfile: '/dist/workflow-client.js',
 *   minify: true,
 *   sourcemap: true
 * })
 *
 * @example
 * // Using in a watch mode build process
 * import esbuild from 'esbuild'
 *
 * const config = createClientBuildConfig({
 *   appDir: process.cwd(),
 *   srcDir: './src',
 *   entryPoint: './src/workflow-entry.tsx',
 *   workflowBlockModulesRef: { blocks: [] }
 * })
 *
 * const ctx = await esbuild.context({
 *   ...config,
 *   outfile: './dist/bundle.js'
 * })
 *
 * await ctx.watch()
 * console.log('Watching for changes...')
 *
 * @example
 * // Integration with build pipeline
 * import esbuild from 'esbuild'
 * import path from 'path'
 *
 * async function buildWorkflowClient(workflowDir: string) {
 *   const config = createClientBuildConfig({
 *     appDir: workflowDir,
 *     srcDir: path.join(workflowDir, 'src'),
 *     entryPoint: path.join(workflowDir, 'src', 'client-entry.tsx'),
 *     workflowBlockModulesRef: { blocks: [] }
 *   })
 *
 *   const result = await esbuild.build({
 *     ...config,
 *     outdir: path.join(workflowDir, 'dist'),
 *     metafile: true,
 *     write: true
 *   })
 *
 *   console.log('Build completed:', result.metafile)
 *   return result
 * }
 */
export function createClientBuildConfig({
  appDir,
  srcDir,
  entryPoint,
  workflowBlockModulesRef,
}: {
  appDir: string
  srcDir: string
  entryPoint: string
  workflowBlockModulesRef: any
}): BuildOptions {
  return {
    entryPoints: [entryPoint],
    logLevel: 'silent',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    plugins: [
      globalExternals({
        react: {
          varName: 'React',
          type: 'cjs',
          namedExports: [
            'default',
            'Children',
            'Component',
            'Fragment',
            'Profiler',
            'PureComponent',
            'StrictMode',
            'Suspense',
            'SuspenseList',
            'cloneElement',
            'createContext',
            'createElement',
            'createFactory',
            'createRef',
            'forwardRef',
            'isValidElement',
            'lazy',
            'memo',
            'startTransition',
            'unstable_SuspenseList',
            'useCallback',
            'useContext',
            'useDebugValue',
            'useDeferredValue',
            'useEffect',
            'useId',
            'useImperativeHandle',
            'useInsertionEffect',
            'useLayoutEffect',
            'useMemo',
            'useReducer',
            'useRef',
            'useState',
            'useSyncExternalStore',
            'useTransition',
          ],
        },
        '@auxx/sdk': {
          varName: 'AUXX_ROOT_SDK',
          type: 'cjs',
        },
        '@auxx/sdk/client': {
          varName: 'AUXX_CLIENT_EXTENSION_SDK',
          type: 'cjs',
        },
      }),
      proxyServerModulesPlugin({ srcDir }),
      proxyBlockModulesPlugin({ appDir, workflowBlockModulesRef }),
    ] as BuildOptions['plugins'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  }
}
