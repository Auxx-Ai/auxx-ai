import chokidar from 'chokidar'
import path from 'path'
import {
  getDiagnostics,
  readConfig,
  type TypeScriptError,
  typeScriptErrorSchema,
} from '../../util/typescript.js'

/**
 * Validate TypeScript files and watch for changes
 * Returns a tuple of [shutdown function, validation function]
 */
export function validateTypeScript(
  onSuccess?: () => void,
  onError?: (errors: TypeScriptError[]) => void
): [() => void, () => Promise<void>] {
  let isShuttingDown = false
  const watcher = chokidar.watch(['src/**/*.ts', 'src/**/*.tsx'], {
    ignored: ['**/node_modules/**', '**/dist/**', '**/*.graphql.d.ts', '**/*.gql.d.ts'],
    cwd: '.',
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  })
  async function handleValidation() {
    if (isShuttingDown) return
    try {
      const result = await readConfig(path.resolve('tsconfig.json'))
      if (typeof result === 'string') {
        // Not a TypeScript project
        onSuccess?.()
        return
      }
      // result is now ts.Program
      const errors = await getDiagnostics(result)
      if (errors.length) {
        onError?.(errors)
      } else {
        onSuccess?.()
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM')
      ) {
        throw error
      }
      if (error instanceof Error) {
        const tsError = typeScriptErrorSchema.parse({ text: error.message })
        onError?.([tsError])
      }
    }
  }
  let watcherReady = false
  watcher.on('ready', () => {
    watcherReady = true
    watcher.on('all', (event) => {
      if (event === 'add' || event === 'change' || event === 'unlink') {
        handleValidation()
      }
    })
  })
  watcher.on('error', (error) => {
    process.stderr.write(`TypeScript watcher error: ${error}\n`)
  })
  return [
    () => {
      isShuttingDown = true
      if (watcherReady) {
        try {
          watcher.close()
        } catch (error) {
          process.stderr.write(`Error closing TypeScript watcher: ${error}\n`)
        }
      }
    },
    handleValidation,
  ]
}
