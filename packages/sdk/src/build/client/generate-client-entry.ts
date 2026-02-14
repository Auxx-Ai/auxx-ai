// packages/sdk/src/build/client/generate-client-entry.ts

/**
 * @file Generates the client-side entry point JavaScript code for Auxx apps.
 *
 * This module is responsible for dynamically creating the entry point code that bootstraps
 * an Auxx app in the client environment. It analyzes the app's source code and assets, then
 * generates JavaScript that:
 *
 * 1. Imports the app configuration from the user's source
 * 2. Registers all available surfaces (actions, widgets, blocks, settings)
 * 3. Imports and registers static assets (images, etc.)
 * 4. Optionally initializes app settings schema
 *
 * The generated code is used as the entry point for esbuild to create the client bundle.
 */

import fs from 'fs/promises'
import path from 'path'
import { Project } from 'ts-morph'
import { APP_SETTINGS_FILENAME } from '../../constants/settings-files.js'
import { USE_SETTINGS } from '../../env.js'
import { complete, errored, fromPromise, isComplete } from '../../errors.js'
import { getAppEntryPoint } from '../../util/get-app-entry-point.js'

/**
 * File extensions for assets that should be bundled with the client.
 * These assets will be imported and registered for use in the app.
 */
const ASSET_FILE_EXTENSIONS = ['png']

/**
 * Generates the client entry point JavaScript code for an Auxx app.
 *
 * This function performs several critical steps to bootstrap the client-side app:
 *
 * **Step 1 - Validate App Export**: Uses ts-morph to parse the app entry point and verify
 * that it exports an `app` object. This object contains all surface definitions.
 *
 * **Step 2 - Discover Assets**: Scans the assets directory recursively to find all static
 * files (currently PNG images) that should be bundled with the app.
 *
 * **Step 3 - Generate Import Statements**: Creates JavaScript imports for:
 * - The app configuration object
 * - All discovered asset files
 * - App settings schema (if settings are enabled)
 *
 * **Step 4 - Generate Registration Code**: Creates JavaScript code that registers:
 * - **Surfaces**: All app extension points (record actions, widgets, workflow blocks, etc.)
 * - **Assets**: Static files with their names and imported data
 * - **Settings**: App settings schema for validation
 *
 * The generated code is designed to be used as an esbuild entry point, which will then
 * bundle all dependencies into the final client bundle.
 *
 * @param params - Configuration for generating the entry point
 * @param params.srcDirAbsolute - Absolute path to the app's source directory where the
 *   app entry point file is located
 * @param params.assetsDirAbsolute - Absolute path to the assets directory containing
 *   static files to bundle
 * @returns A Result containing either the generated JavaScript code as a string, or an
 *   error if the app entry point is not found or doesn't export 'app'
 *
 * @example
 * ```typescript
 * const result = await generateClientEntry({
 *   srcDirAbsolute: '/path/to/app/src',
 *   assetsDirAbsolute: '/path/to/app/assets'
 * })
 *
 * if (isComplete(result)) {
 *   // Write the generated code to a temp file for esbuild
 *   await fs.writeFile(tempFile, result.value)
 * }
 * ```
 *
 * @throws Returns an error Result with code 'APP_ENTRY_POINT_NOT_FOUND' if no app
 *   entry point file exists
 * @throws Returns an error Result with code 'APP_EXPORT_NOT_FOUND' if the entry point
 *   doesn't export an 'app' object
 */
export async function generateClientEntry({
  srcDirAbsolute,
  assetsDirAbsolute,
}: {
  srcDirAbsolute: string
  assetsDirAbsolute: string
}) {
  // Step 1: Locate and load the app entry point file (app.ts or index.ts)
  const appEntryPoint = await getAppEntryPoint(srcDirAbsolute)
  if (!appEntryPoint) {
    return errored({
      code: 'APP_ENTRY_POINT_NOT_FOUND',
    })
  }

  // Step 2: Parse the TypeScript source to verify it exports an 'app' object
  // Using ts-morph's in-memory file system for fast AST parsing without disk I/O
  const tsProject = new Project({
    useInMemoryFileSystem: true,
  })
  const appSourceFile = tsProject.createSourceFile(appEntryPoint.path, appEntryPoint.content)
  const exported = appSourceFile.getExportedDeclarations()
  const hasAppExport = exported.has('app')
  if (!hasAppExport) {
    return errored({
      code: 'APP_EXPORT_NOT_FOUND',
      path: appEntryPoint.path,
    })
  }

  // Step 3: Discover all asset files in the assets directory
  // Safely handle missing assets directory by defaulting to empty array
  const assetFilesResult = await fromPromise(fs.readdir(assetsDirAbsolute, { recursive: true }))
  const assetFiles = isComplete(assetFilesResult) ? assetFilesResult.value : []

  // Filter assets to only include supported file types and map to asset objects
  const assets = assetFiles
    .filter((relativeAssetPath) =>
      ASSET_FILE_EXTENSIONS.some((extension) => relativeAssetPath.endsWith('.' + extension))
    )
    .map((relativeAssetPath) => ({
      path: path.join(assetsDirAbsolute, relativeAssetPath),
      name: relativeAssetPath,
    }))

  // Step 4: Generate JavaScript code sections

  /**
   * Settings initialization code - imports and registers the app settings schema
   * Only included if USE_SETTINGS environment variable is true
   */
  const initSettingsJS = `
        import appSettingsSchema from ${JSON.stringify(path.join(srcDirAbsolute, APP_SETTINGS_FILENAME))}

        registerSettingsSchema(appSettingsSchema)
    `

  /**
   * App import statement - imports the main app configuration object
   */
  const importAppJS = `
        import {app} from ${JSON.stringify(appEntryPoint.path)}
    `

  /**
   * Surface registration code - extracts all surface definitions from the app object
   * and registers them with the runtime. Surfaces include:
   * - Record actions (single and bulk)
   * - Record widgets
   * - Call recording actions (insights, summaries, transcripts)
   * - Workflow blocks (new schema-based API and legacy)
   * - Workflow triggers (new schema-based API and legacy)
   * - Workspace settings
   *
   * Each surface is safely extracted with optional chaining and validated as an array.
   * The type and location fields are added automatically based on where the surface is defined.
   *
   * Supports both:
   * - New API: app.workflow.blocks (array) and app.workflow.triggers (array)
   * - Legacy API: app.workflow.blocks.steps and app.workflow.blocks.triggers
   */
  const registerSurfacesJS = `
        const recordActions = app?.record?.actions
        const bulkRecordActions = app?.record?.bulkActions
        const recordWidgets = app?.record?.widgets
        const callRecordingInsights = app?.callRecording?.insight?.textActions
        const callRecordingSummaries = app?.callRecording?.summary?.textActions
        const callRecordingTranscripts = app?.callRecording?.transcript?.textActions

        // Determine which API is being used
        const workflowBlocksData = app?.workflow?.blocks
        const workflowTriggersData = app?.workflow?.triggers

        // New schema-based workflow API (when blocks is an array)
        const newWorkflowBlocks = Array.isArray(workflowBlocksData) ? workflowBlocksData : []
        const newWorkflowTriggers = Array.isArray(workflowTriggersData) ? workflowTriggersData : []

        // Legacy workflow API (when blocks is an object with steps/triggers properties)
        const legacyWorkflowStepBlocks = workflowBlocksData?.steps
        const legacyWorkflowTriggerBlocks = workflowBlocksData?.triggers

        registerSurfaces({
            "record-action": Array.isArray(recordActions)
                ? recordActions.map((s) => ({ type: "record-action", location: "record-detail-page", ...s }))
                : [],
            "bulk-record-action": Array.isArray(bulkRecordActions)
                ? bulkRecordActions.map((s) => ({ type: "bulk-record-action", location: "record-list-page", ...s }))
                : [],
            "record-widget": Array.isArray(recordWidgets)
                ? recordWidgets.map((s) => ({ type: "record-widget", location: "record-detail-page", ...s }))
                : [],
            "workflow-block": [
                // New API: app.workflow.blocks (schema-based array)
                ...(newWorkflowBlocks.map((block) => ({
                    type: "workflow-block",
                    location: "workflow-editor",
                    blockType: "block",
                    id: block.id,
                    block
                }))),
                // New API: app.workflow.triggers (schema-based array)
                ...(newWorkflowTriggers.map((trigger) => ({
                    type: "workflow-block",
                    location: "workflow-editor",
                    blockType: "trigger",
                    id: trigger.id,
                    block: trigger
                }))),
                // Legacy API: app.workflow.blocks.steps
                ...(Array.isArray(legacyWorkflowStepBlocks)
                    ? legacyWorkflowStepBlocks.map((block) => ({
                        type: "workflow-block",
                        location: "workflow-editor",
                        blockType: "step",
                        id: block.id,
                        block
                    }))
                    : []),
                // Legacy API: app.workflow.blocks.triggers
                ...(Array.isArray(legacyWorkflowTriggerBlocks)
                    ? legacyWorkflowTriggerBlocks.map((block) => ({
                        type: "workflow-block",
                        location: "workflow-editor",
                        blockType: "trigger",
                        id: block.id,
                        block
                    }))
                    : []),
            ],
        })
    `

  /**
   * Asset import statements - creates an import for each discovered asset file
   * Uses generated variable names (A0, A1, A2, etc.) to avoid naming conflicts
   */
  const importAssetsJS = assets
    .map((asset, index) => `import A${index} from ${JSON.stringify(asset.path)};`)
    .join('\n')

  /**
   * Asset registration code - creates an array of asset objects with their names
   * and imported data, then registers them with the runtime
   */
  const registerAssetsJS = `
        const assets = [];

         ${assets
           .map(
             (asset, index) =>
               `assets.push({name: ${JSON.stringify(asset.name)}, data: A${index}});`
           )
           .join('\n')}

        registerAssets(assets);
    `

  /**
   * App component export - creates a default App component if not provided
   * The platform runtime expects window.App to be defined for rendering
   */
  const exportAppComponentJS = `
        // Import the App component (handle both named and default exports)
        import * as appModule from ${JSON.stringify(appEntryPoint.path)}
        const AppComponent = appModule.App || appModule.default

        // Export as window.App for platform runtime
        if (typeof AppComponent === 'function') {
            window.App = AppComponent
        } else {
            // Create default App component if not provided
            window.App = function DefaultApp() {
                return null
            }
        }
    `

  // Step 5: Combine all code sections into the final entry point
  // The order matters: imports first, then settings, then surface registration, then assets, then App export
  return complete(`
        ${importAppJS}
        ${importAssetsJS}

        ${USE_SETTINGS ? initSettingsJS : ''}

        ${registerSurfacesJS}

        ${registerAssetsJS}

        ${exportAppComponentJS}
    `)
}
