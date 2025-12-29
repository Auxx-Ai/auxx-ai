// packages/sdk/src/util/find-surface-exports/walk-dir.ts
import fs from 'fs/promises'
import path from 'path'

/**
 * List of file extensions considered as source files for traversal results.
 */
const EXTENSIONS: readonly string[] = ['js', 'jsx', 'ts', 'tsx']

/**
 * Directory names that should not be traversed while walking the directory tree.
 */
const EXCLUDE_DIRS: readonly string[] = ['node_modules']

/**
 * Checks whether the provided path points to a supported source file by validating its extension.
 *
 * @param filePath - The absolute or relative path to the file to check
 * @returns True if the file has a supported source extension (.js, .jsx, .ts, .tsx), false otherwise
 */
function isSrcFile(filePath: string): boolean {
  return EXTENSIONS.some((extension) => filePath.endsWith(`.${extension}`))
}

/**
 * Recursively walks a directory tree and yields all matching source files.
 *
 * This async generator function traverses the directory structure, yielding paths to all
 * files with supported extensions while excluding specified directories (e.g., node_modules).
 * Files are yielded in the order they are discovered, with subdirectories processed after
 * files in the current directory.
 *
 * @param dir - The root directory path to start walking from
 * @yields Absolute paths to all discovered source files
 * @throws If the directory cannot be read or accessed
 *
 * @example
 * ```typescript
 * for await (const filePath of walkDir('./src')) {
 *   console.log(filePath);
 * }
 * ```
 */
export async function* walkDir(
  dir: string,
): AsyncGenerator<string, void, unknown> {
  const currentDirFiles = await fs.readdir(dir, { withFileTypes: true })
  const walkSubDirIterators: AsyncGenerator<string, void, unknown>[] = []
  for (const file of currentDirFiles) {
    const fullPath = path.join(dir, file.name)
    if (file.isDirectory() && !EXCLUDE_DIRS.includes(file.name)) {
      walkSubDirIterators.push(walkDir(fullPath))
    } else if (isSrcFile(fullPath)) {
      yield fullPath
    }
  }
  for (const walkSubDirIterator of walkSubDirIterators) {
    for await (const filePath of walkSubDirIterator) {
      yield filePath
    }
  }
}
