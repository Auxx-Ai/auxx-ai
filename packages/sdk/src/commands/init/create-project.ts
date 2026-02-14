// packages/sdk/src/commands/init/create-project.ts

import { existsSync } from 'fs'
import { access, constants } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import type z from 'zod'
import type { appInfoSchema } from '../../api/schemas.js'
import { complete, errored, isErrored } from '../../errors.js'
import { copyWithTransform } from '../../util/copy-with-transform.js'
import { createDirectory } from '../../util/create-directory.js'
import { spinnerify } from '../../util/spinner.js'

export type CreateProjectError =
  | { code: 'DIRECTORY_ALREADY_EXISTS'; path: string }
  | { code: 'WRITE_ACCESS_DENIED'; path: string }
  | { code: 'COPY_ERROR'; error: Error }
  | { code: 'TEMPLATE_NOT_FOUND'; path: string }

// export interface AppInfo {
//   app_id: string
//   title: string
//   description: string | null
//   slug: string
// }
type AppInfo = z.infer<typeof appInfoSchema>['data']['app']
/**
 * Create a new Auxx app project from template
 */
export async function createProject({ appSlug, appInfo }: { appSlug: string; appInfo: AppInfo }) {
  return await spinnerify('Creating project...', 'Project created successfully', async () => {
    const cwd = process.cwd()
    const projectPath = path.join(cwd, appSlug)

    // Check if directory already exists
    if (existsSync(projectPath)) {
      return errored({ code: 'DIRECTORY_ALREADY_EXISTS', path: projectPath })
    }

    // Check write access to current directory
    try {
      await access(cwd, constants.W_OK)
    } catch {
      return errored({ code: 'WRITE_ACCESS_DENIED', path: cwd })
    }

    // Find template directory (relative to this compiled file in lib/)
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const templateDir = path.resolve(__dirname, '../../../template')

    // Check template exists
    if (!existsSync(templateDir)) {
      return errored({ code: 'TEMPLATE_NOT_FOUND', path: templateDir })
    }

    // Create project directory
    const projectDirResult = await createDirectory(appSlug)
    if (isErrored(projectDirResult)) {
      return projectDirResult // errored({ code: 'COPY_ERROR', error: new Error('Failed to create directory') })
    }

    const projectDir = projectDirResult.value

    // Transform function to replace placeholders
    const transform = (contents: string) =>
      contents
        .replaceAll('title-to-be-replaced', appInfo.title)
        .replaceAll('id-to-be-replaced', appInfo.id)
        .replaceAll('slug-to-be-replaced', appSlug)
        .replaceAll('description-to-be-replaced', appInfo.description || 'An Auxx application')

    // Copy template files with transformations
    const result = await copyWithTransform(templateDir, projectDir, transform)

    if (isErrored(result)) {
      return result
      // return errored({ code: 'COPY_ERROR', error: result.error.error })
    }
    return complete(undefined)
  })
}
