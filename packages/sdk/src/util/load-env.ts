// packages/sdk/src/util/load-env.ts

import dotenv from 'dotenv'
import { promises as fs } from 'fs'

/**
 * Checks whether the provided filesystem path exists and is accessible using
 * `fs.access`, resolving to a boolean instead of throwing on missing files.
 *
 * @param path Absolute or relative path to stat.
 * @returns `true` when the path exists; otherwise `false`.
 */
const fileExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
const PATH = '.env'

/**
 * Loads environment variables from the local `.env` file using `dotenv.parse`.
 * When no file exists, the function resolves with an empty object, allowing
 * callers to conditionally merge default values. Parsing errors bubble as
 * descriptive exceptions to aid debugging.
 *
 * @returns Key-value object containing env entries or an empty object when `.env` is missing.
 * @throws {Error} When the `.env` file cannot be parsed by `dotenv`.
 */
export async function loadEnv(): Promise<Record<string, string>> {
  if (!(await fileExists(PATH))) return {}
  const contents = await fs.readFile(PATH, { encoding: 'utf8' })
  try {
    return dotenv.parse(contents)
  } catch {
    throw new Error(`Failed to parse ${PATH}`)
  }
}
