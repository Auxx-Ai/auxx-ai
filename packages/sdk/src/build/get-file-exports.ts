// packages/sdk/src/build/get-file-exports.ts

import fs from 'fs/promises'
import { Project } from 'ts-morph'
import { complete, errored, fromPromise, isErrored } from '../errors.js'

/**
 * Read a TypeScript source file and return its exported declarations.
 *
 * @param filePath Absolute path to the source file to inspect.
 * @returns A `Result` containing the declaration map or a read failure error.
 */
export async function getFileExports(filePath: string) {
  const contentResult = await fromPromise(fs.readFile(filePath))
  if (isErrored(contentResult)) {
    return errored({ code: 'FILE_NOT_READABLE', cause: contentResult.error })
  }
  const content = contentResult.value.toString()
  const tsProject = new Project({ useInMemoryFileSystem: true })
  const appSourceFile = tsProject.createSourceFile(filePath, content)
  return complete(appSourceFile.getExportedDeclarations())
}
