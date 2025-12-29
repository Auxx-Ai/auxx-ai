import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
// import type { Result } from '../types/result.js'
import { complete, errored, type AppSlugError } from '../errors.js'

const packageJsonSchema = z.object({
  name: z.string({
    required_error: 'No name field found in package.json',
    invalid_type_error: `"name" must be a string in package.json`,
  }),
})

/**
 * Get app slug from package.json name field
 */
export async function getAppSlugFromPackageJson() {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json')
    const packageJsonRaw = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const result = packageJsonSchema.safeParse(packageJsonRaw)
    if (!result.success) {
      return errored<AppSlugError>({ code: 'MALFORMED_PACKAGE_JSON', error: result.error })
    }
    return complete(result.data.name) //{ success: true, value: result.data.name }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errored<AppSlugError>({ code: 'INVALID_JSON', error })
    }
    return errored<AppSlugError>({ code: 'FILE_SYSTEM_ERROR', error: error as unknown as Error })
  }
}
