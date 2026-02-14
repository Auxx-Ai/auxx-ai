// packages/sdk/src/util/create-directory.ts

import { constants, promises as fs } from 'fs'
import { join } from 'path'
import { type CreateProjectError, complete, errored, type Result } from '../errors.js'

/**
 * Creates a new directory in the current working directory when it does not
 * already exist and the process has write permissions.
 *
 * @param name Directory name (relative to `process.cwd()`).
 * @returns `Result` resolving to the absolute path of the created directory or a typed error.
 *
 * @example
 * ```ts
 * const result = await createDirectory('my-app')
 * if (result.state === 'complete') {
 *   console.log(`Created at ${result.value}`)
 * } else {
 *   console.error(result.error.code)
 * }
 * ```
 */
export const createDirectory = async (
  name: string
): Promise<Result<string, CreateProjectError>> => {
  const currentDir = process.cwd()
  const newPath = join(currentDir, name)
  try {
    if (
      await fs
        .access(newPath)
        .then(() => true)
        .catch(() => false)
    ) {
      return errored({
        code: 'DIRECTORY_ALREADY_EXISTS',
        path: newPath,
      })
    }
    await fs.access(currentDir, constants.W_OK)
    await fs.mkdir(newPath)
    return complete(newPath)
  } catch {
    return errored({
      code: 'WRITE_ACCESS_DENIED',
      path: name,
    })
  }
}
