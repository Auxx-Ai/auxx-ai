// packages/sdk/src/util/compile-and-extract-ai-tools.ts

import * as esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { complete, errored, type Result } from '../errors.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SDK_ROOT = path.resolve(__dirname, '..', '..')

export interface AiToolCatalogPayload {
  tools: Array<{
    id: string
    name: string
    description: string
    inputsJsonSchema: Record<string, unknown>
    outputsJsonSchema: Record<string, unknown>
    requiresConnection: boolean
    connectionScope: 'user' | 'organization' | null
    requiresApproval: boolean | { predicate: string }
    timeoutMs: number
    streaming: boolean
    toolsetSlug: string
    refs: Array<{ path: string[]; kind: string }>
  }>
  toolsets: Array<{
    slug: string
    name: string
    description: string
    iconKey: string | null
    isDefault: boolean
    subGroup: string | null
  }>
}

export type CompileAndExtractAiToolsError =
  | { code: 'APP_ENTRY_NOT_FOUND' }
  | { code: 'AI_TOOLS_COMPILE_FAILED'; error: Error }
  | { code: 'AI_TOOLS_LOAD_FAILED'; error: Error }
  | { code: 'AI_TOOLS_VALIDATION_FAILED'; message: string }

/**
 * Compile the app entry point in catalog-extraction mode and read
 * `app.ai.{tools,toolsets}` to produce the publish-time catalog payload.
 *
 * `.server.ts(x)` imports are stubbed (their default export is a `() => {}`
 * placeholder) so the bundle can be imported in plain Node without invoking
 * server-only code. Author-side icons/PNGs are loaded as empty data-urls.
 *
 * The resulting payload is shipped through `createDeployment` and persisted
 * onto `AppDeployment.aiTools`. See plans/kopilot/apps/README.md §5.
 */
export async function compileAndExtractAiTools(): Promise<
  Result<AiToolCatalogPayload | undefined, CompileAndExtractAiToolsError>
> {
  const srcDirAbsolute = path.resolve('src')
  // Try common entry points
  const candidates = ['app.ts', 'app.tsx']
  let appEntry: string | undefined
  for (const c of candidates) {
    const p = path.join(srcDirAbsolute, c)
    try {
      await fs.access(p)
      appEntry = p
      break
    } catch {
      // not this one
    }
  }
  if (!appEntry) {
    return complete(undefined)
  }

  const auxxDir = path.resolve(HIDDEN_AUXX_DIRECTORY)
  await fs.mkdir(auxxDir, { recursive: true })
  const outputPath = path.join(auxxDir, 'app.catalog.mjs')

  // Stub plugin for `.server.ts(x)` imports — they're not safe to evaluate
  // at catalog-extraction time. Replace the default export with a no-op.
  const stubServerImports: esbuild.Plugin = {
    name: 'auxx-stub-server-imports',
    setup(build) {
      build.onResolve({ filter: /\.server(\.tsx?)?$/ }, (args) => ({
        path: args.path,
        namespace: 'auxx-server-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auxx-server-stub' }, () => ({
        contents: 'export default async () => { throw new Error("stubbed at catalog extraction") }',
        loader: 'js',
      }))
    },
  }

  // Resolver for `@auxx/sdk` and subpaths. The published package's exports
  // map most subpaths to types-only (e.g. `@auxx/sdk/client`, `@auxx/sdk/server`),
  // so there's no runtime file to load. We resolve the two real entry points
  // we need (bare + `/ai`) and stub the rest with an empty module — the
  // catalog extractor only reads `app.ai.{tools,toolsets}`, so other surfaces
  // don't need real runtime.
  const SDK_REAL_BARE = path.join(SDK_ROOT, 'lib', 'root', 'index.js')
  const SDK_REAL_AI = path.join(SDK_ROOT, 'lib', 'root', 'ai', 'index.js')
  const stubSdkSubpaths: esbuild.Plugin = {
    name: 'auxx-stub-sdk-subpaths',
    setup(build) {
      build.onResolve({ filter: /^@auxx\/sdk(\/.*)?$/ }, (args) => {
        if (args.path === '@auxx/sdk') return { path: SDK_REAL_BARE }
        if (args.path === '@auxx/sdk/ai') return { path: SDK_REAL_AI }
        return { path: args.path, namespace: 'auxx-sdk-stub' }
      })
      // CJS module shape with a Proxy: any named import becomes a no-op
      // function. esbuild treats CJS modules as opaque, so authors can
      // `import { Whatever } from '@auxx/sdk/client'` without esbuild
      // requiring `Whatever` to be a real declared export.
      build.onLoad({ filter: /.*/, namespace: 'auxx-sdk-stub' }, () => ({
        contents: `
          const noop = () => null;
          const handler = { get: (target, prop) => {
            if (prop in target) return target[prop];
            if (prop === '__esModule') return true;
            if (typeof prop === 'symbol') return undefined;
            return noop;
          }};
          module.exports = new Proxy({}, handler);
        `,
        loader: 'js',
      }))
    },
  }

  try {
    await esbuild.build({
      entryPoints: [appEntry],
      bundle: true,
      outfile: outputPath,
      format: 'esm',
      platform: 'node',
      target: ['node18'],
      logLevel: 'silent',
      write: true,
      loader: {
        '.png': 'empty',
        '.jpg': 'empty',
        '.jpeg': 'empty',
        '.gif': 'empty',
        '.webp': 'empty',
        '.svg': 'empty',
      },
      plugins: [stubServerImports, stubSdkSubpaths],
    })
  } catch (error) {
    return errored({
      code: 'AI_TOOLS_COMPILE_FAILED',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }

  let appModule: { app?: unknown }
  try {
    const fileUrl = pathToFileURL(outputPath).href
    appModule = await import(`${fileUrl}?t=${Date.now()}`)
  } catch (error) {
    return errored({
      code: 'AI_TOOLS_LOAD_FAILED',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }

  const app = appModule.app as
    | {
        ai?: {
          tools?: ReadonlyArray<unknown>
          toolsets?: ReadonlyArray<unknown>
        }
      }
    | undefined
  if (!app?.ai || (!app.ai.tools?.length && !app.ai.toolsets?.length)) {
    return complete(undefined)
  }

  // Lazy import the converter — keeps it out of bundle path when no AI tools.
  const { zodToProviderToolSchema } = await import('../build/server/zod-to-provider-tool-schema.js')

  const toolsArr = (app.ai.tools ?? []) as Array<{
    id: string
    name: string
    description: string
    inputs: unknown
    outputs: unknown
    config?: {
      requiresConnection?: boolean
      connectionScope?: 'user' | 'organization'
      requiresApproval?: boolean | ((args: unknown) => boolean)
      timeout?: number
      streaming?: boolean
    }
  }>
  const toolsetsArr = (app.ai.toolsets ?? []) as Array<{
    id: string
    name: string
    description: string
    icon?: unknown
    tools?: ReadonlyArray<string>
    isDefault?: boolean
    subGroup?: string
  }>

  const slugByToolId = new Map<string, string>()
  const cataloguedToolsets: AiToolCatalogPayload['toolsets'] = []
  for (const ts of toolsetsArr) {
    const slug = `app:${ts.id.replace('.', ':')}`
    cataloguedToolsets.push({
      slug,
      name: ts.name,
      description: ts.description,
      iconKey: null,
      isDefault: Boolean(ts.isDefault),
      subGroup: ts.subGroup ?? null,
    })
    for (const toolId of ts.tools ?? []) {
      slugByToolId.set(toolId, slug)
    }
  }

  const cataloguedTools: AiToolCatalogPayload['tools'] = []
  for (const tool of toolsArr) {
    if (!tool?.id) {
      return errored({
        code: 'AI_TOOLS_VALIDATION_FAILED',
        message: 'AI tool is missing an id',
      })
    }
    const inputs = zodToProviderToolSchema(tool.inputs as never)
    const outputs = zodToProviderToolSchema(tool.outputs as never)
    const requiresApproval =
      typeof tool.config?.requiresApproval === 'function'
        ? { predicate: tool.config.requiresApproval.toString() }
        : Boolean(tool.config?.requiresApproval ?? false)

    cataloguedTools.push({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputsJsonSchema: inputs.jsonSchema,
      outputsJsonSchema: outputs.jsonSchema,
      requiresConnection: Boolean(tool.config?.requiresConnection),
      connectionScope: tool.config?.connectionScope ?? null,
      requiresApproval,
      timeoutMs: tool.config?.timeout ?? 15000,
      streaming: Boolean(tool.config?.streaming),
      toolsetSlug: slugByToolId.get(tool.id) ?? `app:unknown:default`,
      refs: outputs.refs,
    })
  }

  return complete({ tools: cataloguedTools, toolsets: cataloguedToolsets })
}
