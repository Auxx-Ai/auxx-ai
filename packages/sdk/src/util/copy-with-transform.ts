// // packages/sdk/src/util/copy-with-transform.ts

import { Dirent, promises as fs } from 'fs'
import path from 'path'
import {
  combineAsync,
  complete,
  CreateProjectError,
  errored,
  isErrored,
  Result,
} from '../errors.js'

/**
 * Recursively copies a directory from source to destination, applying a transform function
 * to all text-based files. Image files (jpg, jpeg, png, gif, svg, webp, ico) are copied
 * directly without transformation.
 *
 * This function is typically used for scaffolding project templates where placeholder values
 * need to be replaced with actual project-specific values.
 *
 * @param srcDir - The absolute path to the source directory to copy from
 * @param destDir - The absolute path to the destination directory to copy to
 * @param transform - A function that takes file content as a string and returns the transformed content.
 *                    This function is applied to all non-image files.
 *
 * @returns A Result object containing either success (void) or a CreateProjectError
 *
 * @example
 * // Basic usage: Replace template placeholders
 * const result = await copyWithTransform(
 *   '/path/to/template',
 *   '/path/to/new-project',
 *   (content) => content.replace(/{{PROJECT_NAME}}/g, 'my-app')
 * )
 *
 * if (isErrored(result)) {
 *   console.error('Copy failed:', result.error)
 * }
 *
 * @example
 * // Multiple replacements using a replacements map
 * const replacements = {
 *   '{{PROJECT_NAME}}': 'my-app',
 *   '{{AUTHOR}}': 'Jane Doe',
 *   '{{VERSION}}': '1.0.0'
 * }
 *
 * const result = await copyWithTransform(
 *   '/templates/default',
 *   '/projects/my-app',
 *   (content) => {
 *     let transformed = content
 *     for (const [key, value] of Object.entries(replacements)) {
 *       transformed = transformed.replace(new RegExp(key, 'g'), value)
 *     }
 *     return transformed
 *   }
 * )
 *
 * @example
 * // Case conversion for package names
 * const result = await copyWithTransform(
 *   './template',
 *   './new-package',
 *   (content) => content
 *     .replace(/{{PACKAGE_NAME}}/g, 'my-package')
 *     .replace(/{{PACKAGE_NAME_CAMEL}}/g, 'myPackage')
 *     .replace(/{{PACKAGE_NAME_PASCAL}}/g, 'MyPackage')
 * )
 *
 * @example
 * // Error handling
 * const result = await copyWithTransform(
 *   '/src/template',
 *   '/dest/project',
 *   (content) => content.replace(/{{VAR}}/g, 'value')
 * )
 *
 * if (isErrored(result)) {
 *   switch (result.error.code) {
 *     case 'FAILED_TO_CREATE_DIRECTORY':
 *       console.error('Cannot create directory:', result.error.path)
 *       break
 *     case 'FAILED_TO_LIST_FILES':
 *       console.error('Cannot read source directory:', result.error.path)
 *       break
 *     case 'FAILED_TO_READ_FILE':
 *       console.error('Cannot read file:', result.error.path)
 *       break
 *     case 'FAILED_TO_WRITE_FILE':
 *       console.error('Cannot write file:', result.error.path)
 *       break
 *     case 'FAILED_TO_COPY_FILE':
 *       console.error('Cannot copy file from', result.error.src, 'to', result.error.dest)
 *       break
 *   }
 * }
 */
export async function copyWithTransform(
  srcDir: string,
  destDir: string,
  transform: (content: string) => string
): Promise<Result<void, CreateProjectError>> {
  try {
    await fs.mkdir(destDir, { recursive: true })
  } catch {
    return errored({ code: 'FAILED_TO_CREATE_DIRECTORY', path: destDir })
  }
  let entries: Dirent[]
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true })
  } catch {
    return errored({ code: 'FAILED_TO_LIST_FILES', path: srcDir })
  }
  const results = await combineAsync(
    entries.map(async (entry: Dirent) => {
      const srcPath = path.join(srcDir, entry.name)
      const destPath = path.join(destDir, entry.name)
      if (entry.isDirectory()) {
        return await copyWithTransform(srcPath, destPath, transform)
      } else if (entry.isFile()) {
        if (/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i.test(entry.name)) {
          try {
            await fs.copyFile(srcPath, destPath)
          } catch {
            return errored({ code: 'FAILED_TO_COPY_FILE', src: srcPath, dest: destPath })
          }
        } else {
          let content
          try {
            content = await fs.readFile(srcPath, 'utf8')
          } catch {
            return errored({ code: 'FAILED_TO_READ_FILE', path: srcPath })
          }
          content = transform(content)
          try {
            await fs.writeFile(destPath, content, 'utf8')
          } catch {
            return errored({ code: 'FAILED_TO_WRITE_FILE', path: destPath })
          }
        }
      }
      return complete(undefined)
    })
  )
  if (isErrored(results)) {
    return results
  }
  return complete(undefined)
}
