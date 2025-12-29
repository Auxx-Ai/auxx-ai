// packages/sdk/src/util/find-surface-exports/find-surface-exports.ts
import fs from 'fs/promises'
import path from 'path'
import { Project, type SourceFile, type Symbol as MorphSymbol } from 'ts-morph'
import { complete, errored, isComplete, type Result } from '../../errors.js'
import { generateRandomFileName } from './generate-random-file-name.js'
import { parseFileExports, type SurfaceExport, type SurfaceTypesMap } from './parse-file-exports.js'
import { surfaceTypeDefinitions } from './surface-types.js'
import { walkDir } from './walk-dir.js'

/**
 * Possible error types that can occur when loading a source file.
 */
type FileLoadError =
  | { code: 'FILE_NOT_FOUND' }
  | { code: 'UNKNOWN_ERROR' }

/**
 * Result type for source file loading operations.
 * Contains either a successfully loaded SourceFile or a FileLoadError.
 */
type LoadSourceFileResult = Result<SourceFile, FileLoadError>

/**
 * Scans a directory tree and discovers all surface exports with their file locations.
 *
 * This is the main entry point for surface export discovery. It performs the following operations:
 *
 * 1. Creates an in-memory TypeScript project using ts-morph
 * 2. Generates type definitions for all surface types for validation
 * 3. Recursively walks the directory tree to find all source files
 * 4. Loads each source file into the ts-morph project
 * 5. Parses each file for valid surface exports
 * 6. Validates surface exports against their type definitions
 * 7. Ensures all surface IDs are globally unique
 *
 * Surface exports are special named exports that match predefined surface type names
 * (e.g., 'recordAction', 'workflowBlock') and conform to their respective interfaces.
 *
 * @param rootDir - The root directory path to scan for surface exports
 * @returns Array of tuples containing file paths and their discovered surface exports.
 *          Format: `[[filePath, [surfaceExport1, surfaceExport2, ...]], ...]`
 * @throws Error if surface exports have type mismatches or duplicate IDs
 *
 * @example
 * ```typescript
 * const exports = await findSurfaceExports('./src');
 * // Returns:
 * // [
 * //   ['/path/to/file1.ts', [{ surfaceType: 'recordAction', id: 'my-action' }]],
 * //   ['/path/to/file2.ts', [{ surfaceType: 'workflowBlock', id: 'my-block' }]]
 * // ]
 * ```
 */
export async function findSurfaceExports(
  rootDir: string
): Promise<Array<[string, SurfaceExport[]]>> {
  const existingExportSymbols = new Set<MorphSymbol>()
  const existingIds = new Set<string>()
  const tsProject = new Project({
    compilerOptions: { allowJs: true },
    useInMemoryFileSystem: true,
  })
  const surfaceTypesFilePath = path.join(rootDir, generateRandomFileName('ts'))
  const surfaceTypesSourceFile = tsProject.createSourceFile(
    surfaceTypesFilePath,
    surfaceTypeDefinitions
  )
  const surfaceTypes: SurfaceTypesMap = {
    recordAction: surfaceTypesSourceFile.getInterfaceOrThrow('RecordAction').getType(),
    bulkRecordAction: surfaceTypesSourceFile.getInterfaceOrThrow('BulkRecordAction').getType(),
    recordWidget: surfaceTypesSourceFile.getInterfaceOrThrow('RecordWidget').getType(),
    callRecordingInsightTextSelectionAction: surfaceTypesSourceFile
      .getInterfaceOrThrow('CallRecordingInsightTextSelectionAction')
      .getType(),
    callRecordingSummaryTextSelectionAction: surfaceTypesSourceFile
      .getInterfaceOrThrow('CallRecordingSummaryTextSelectionAction')
      .getType(),
    callRecordingTranscriptTextSelectionAction: surfaceTypesSourceFile
      .getInterfaceOrThrow('CallRecordingTranscriptTextSelectionAction')
      .getType(),
    organizationSettings: surfaceTypesSourceFile.getInterfaceOrThrow('OrganizationSettings').getType(),
    workflowBlock: surfaceTypesSourceFile.getInterfaceOrThrow('WorkflowBlock').getType(),
  }

  const typeChecker = tsProject.getTypeChecker()

  /**
   * Reads a file from disk and loads it into the in-memory ts-morph project.
   *
   * @param filePath - Absolute path to the source file to load
   * @returns Result containing either the loaded SourceFile or a FileLoadError
   */
  async function loadSourceFile(filePath: string): Promise<LoadSourceFileResult> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8')
      return complete(tsProject.createSourceFile(filePath, fileContent, { overwrite: true }))
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        return errored({ code: 'FILE_NOT_FOUND' })
      }
      return errored({ code: 'UNKNOWN_ERROR' })
    }
  }

  const loadSourceFilesPromises: Array<Promise<LoadSourceFileResult>> = []
  const surfaceExportsByPath: Array<[string, SurfaceExport[]]> = []

  for await (const filePath of walkDir(rootDir)) {
    loadSourceFilesPromises.push(loadSourceFile(filePath))
  }
  const sourceFileResults: LoadSourceFileResult[] = await Promise.all(loadSourceFilesPromises)
  for (const sourceFileResult of sourceFileResults) {
    if (!isComplete(sourceFileResult)) {
      continue
    }
    const surfaceExports = parseFileExports({
      sourceFile: sourceFileResult.value,
      existingExportSymbols,
      existingIds,
      typeChecker,
      surfaceTypes,
    })
    if (surfaceExports.size > 0) {
      surfaceExportsByPath.push([sourceFileResult.value.getFilePath(), [...surfaceExports]])
    }
  }
  return surfaceExportsByPath
}
