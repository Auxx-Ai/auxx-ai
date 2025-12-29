// packages/sdk/src/util/generate-app-entry-point.ts
import fs from 'fs/promises'
import path from 'path'
import { complete, fromPromise, isErrored, type Result } from '../errors.js'
import { findSurfaceExports } from './find-surface-exports/find-surface-exports.js'
import { type SurfaceExport } from './find-surface-exports/parse-file-exports.js'
import { toCamelCase } from './to-camel-case.js'

// Ordered list of supported surface types used to assemble the generated entry point.
export const SURFACE_TYPES = [
  'recordAction',
  'bulkRecordAction',
  'recordWidget',
  'callRecordingInsightTextSelectionAction',
  'callRecordingSummaryTextSelectionAction',
  'callRecordingTranscriptTextSelectionAction',
  'organizationSettings',
  'workflowBlock',
] as const

// Describes the import metadata tracked for each surface id.
type SurfaceImport = { importPath: string; id: string }

// Alias representing the valid surface type identifiers used across the SDK.
type SurfaceTypeName = SurfaceExport['surfaceType']

// Maps each surface type to its associated import declarations.
type SurfaceImportMap = Record<SurfaceTypeName, SurfaceImport[]>

// Generates the App entry point file based on discovered surface exports.
export async function generateAppEntryPoint(
  srcDirAbsolute: string
): Promise<Result<boolean, unknown>> {
  const surfaceExports: Array<[string, SurfaceExport[]]> = await findSurfaceExports(srcDirAbsolute)
  const surfaceImportFilesByType: SurfaceImportMap = Object.create(null)
  for (const surfaceType of SURFACE_TYPES) {
    surfaceImportFilesByType[surfaceType] = []
  }

  for (const [filePath, surfaces] of surfaceExports) {
    for (const surface of surfaces) {
      surfaceImportFilesByType[surface.surfaceType].push({
        importPath: getRelativeImportPath(srcDirAbsolute, filePath),
        id: surface.id,
      })
    }
  }

  const appImportStatement = `import type {App} from "@auxx/sdk"`
  const surfaceImportsStatements = SURFACE_TYPES.flatMap((surfaceType) => {
    const surfaceImports = surfaceImportFilesByType[surfaceType]

    return surfaceImports.map((surface) => {
      const surfaceName = getSurfaceImportName(surface.id)
      return `import {${surfaceType}${surfaceName !== surfaceType ? ` as ${surfaceName}` : ''}} from ${JSON.stringify(surface.importPath)}`
    })
  }).join('\n')

  const getSurfaceNamesArray = (surfaceType: SurfaceTypeName) => {
    const surfaceImports = surfaceImportFilesByType[surfaceType]
    return surfaceImports.map((surface) => getSurfaceImportName(surface.id))
  }

  const organizationSettings = getSurfaceNamesArray('organizationSettings')
  const hasOrganizationSettings = organizationSettings.length > 0

  const appExportStatement = `export const app: App = {
    record: {
        actions: [${getSurfaceNamesArray('recordAction').join(',')}],
        bulkActions: [${getSurfaceNamesArray('bulkRecordAction').join(',')}],
        widgets: [${getSurfaceNamesArray('recordWidget').join(',')}],
    },
    callRecording: {
        insight: {
            textActions: [${getSurfaceNamesArray('callRecordingInsightTextSelectionAction')}]
        },
        summary: {
            textActions: [${getSurfaceNamesArray('callRecordingSummaryTextSelectionAction')}]
        },
        transcript: {
            textActions: [${getSurfaceNamesArray('callRecordingTranscriptTextSelectionAction')}]
        },
    },${hasOrganizationSettings ? `
    settings: {
        organization: ${organizationSettings},
    },` : ''}
}`

  const appComponentExport = `/**
 * Main App Component
 *
 * This component is rendered by the Auxx platform when your extension's
 * settings page is viewed, or as the main UI in certain contexts.
 *
 * You can customize this to show:
 * - Configuration options
 * - Status information
 * - Extension documentation
 *
 * IMPORTANT: This must be a React component. The build process will
 * make this available as window.App for the platform runtime.
 */
export function App() {
    // TODO: Customize your extension's main UI here
    // For now, this returns null (no UI)
    // Example:
    // return <div style={{ padding: '20px' }}>
    //   <h1>My Extension</h1>
    //   <p>Configure your extension settings here</p>
    // </div>
    return null
}`

  const appEntryPointContent = [
    appImportStatement,
    surfaceImportsStatements,
    appExportStatement,
    appComponentExport,
  ].join('\n\n')
  const writeResult = await fromPromise(
    fs.writeFile(path.join(srcDirAbsolute, 'app.ts'), appEntryPointContent)
  )
  if (isErrored(writeResult)) {
    return writeResult
  }
  return complete(true)
}

// Computes a relative ESM import path from the root directory to the target file.
function getRelativeImportPath(dir: string, filePath: string): string {
  const relativePath = path
    .relative(dir, filePath)
    .split(path.sep)
    .join('/')
    .replace(/\.[^/.]+$/, '')
  if (relativePath.startsWith('.')) {
    return relativePath
  }
  return `./${relativePath}`
}

// Normalises a surface id into the import name used within the generated file.
function getSurfaceImportName(surfaceId: string): string {
  return toCamelCase(surfaceId)
}
