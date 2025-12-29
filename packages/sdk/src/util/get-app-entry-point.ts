// packages/sdk/src/util/get-app-entry-point.ts

import fs from 'fs/promises'
import path from 'path'
import { fromPromise, isErrored } from '../errors.js'

/**
 * File extensions checked when resolving the app entry module within a source directory.
 */
const APP_ENTRY_POINT_EXTENSIONS = ['ts', 'tsx'] as const

/**
 * Attempts to locate the `app.ts` or `app.tsx` entry point within the provided
 * directory, returning the first matching file's absolute path and UTF-8
 * contents. Failed file reads are treated as missing files instead of throwing
 * so the search can continue.
 *
 * @param srcDirAbsolute Absolute path to the application source directory.
 * @returns Promise resolving with the entry point metadata or `null` when not found.
 *
 * @example
 * ```ts
 * const entryPoint = await getAppEntryPoint('/repo/apps/web/src')
 * if (entryPoint) {
 *   console.log(entryPoint.path)
 *   console.log(entryPoint.content.substring(0, 80))
 * }
 * ```
 */
export async function getAppEntryPoint(
  srcDirAbsolute: string
): Promise<{ path: string; content: string } | null> {
  const appEntryPoints = await Promise.all(
    APP_ENTRY_POINT_EXTENSIONS.map(async (extension) => {
      const filePath = path.join(srcDirAbsolute, `app.${extension}`)
      const contentResult = await fromPromise(fs.readFile(filePath))
      if (isErrored(contentResult)) {
        return null
      }
      return {
        path: filePath,
        content: contentResult.value.toString(),
      }
    })
  )
  return appEntryPoints.find((entryPoint) => entryPoint !== null) ?? null
}
