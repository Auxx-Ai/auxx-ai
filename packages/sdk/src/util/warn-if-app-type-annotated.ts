// packages/sdk/src/util/warn-if-app-type-annotated.ts

import path from 'path'
import { getAppEntryPoint } from './get-app-entry-point.js'

/**
 * `App.fields` is `ReadonlyArray<AppFieldDefinition>`, so annotating the entry's
 * `app` export `: App` widens and **erases** the field literals — the typed
 * value-I/O surface then silently degrades to permissive. This detects that
 * annotation so the degradation is never silent.
 *
 * Heuristic (no full parse): matches `export const app: App` / `export const app: App<…>`
 * on the entry source. `satisfies App` and an unannotated `export const app`
 * both preserve literals and are intentionally NOT flagged.
 *
 * @param rootDirAbsolute Absolute path to the app root. Defaults to cwd.
 * @returns `true` when the entry's `app` export is `: App`-annotated.
 */
export async function isAppExportTypeAnnotated(
  rootDirAbsolute: string = path.resolve('.')
): Promise<boolean> {
  const entryPoint = await getAppEntryPoint(path.join(rootDirAbsolute, 'src'))
  if (entryPoint === null) {
    return false
  }
  return /export\s+const\s+app\s*:\s*App\b/.test(entryPoint.content)
}
