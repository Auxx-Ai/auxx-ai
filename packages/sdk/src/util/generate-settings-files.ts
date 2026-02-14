import fs from 'fs/promises'
import path from 'path'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { APP_SETTINGS_FILENAME, SETTINGS_TYPES_FILENAME } from '../constants/settings-files.js'
import { combineAsync, complete, errored, isErrored } from '../errors.js'

const SETTINGS_SCHEMA_FILE_CONTENT = `import type {SettingsSchema} from "@auxx/sdk"

export const appSettingsSchema = {
    user: {},
    organization: {},
} satisfies SettingsSchema

export default appSettingsSchema
`
const SETTINGS_TYPES_FILE_CONTENT = `import "@auxx/sdk"

import type appSettingsSchema from "../app.settings"

declare module "@auxx/sdk" {
    export interface AppSettingsSchema {
        user: (typeof appSettingsSchema)["user"]
        organization: (typeof appSettingsSchema)["organization"]
    }
}
`
async function generateSettingsSchema(srcDirAbsolute: string) {
  const settingsSchemaFilePath = path.join(srcDirAbsolute, APP_SETTINGS_FILENAME)
  try {
    await fs.readFile(settingsSchemaFilePath)
    return complete(undefined)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      try {
        await fs.writeFile(settingsSchemaFilePath, SETTINGS_SCHEMA_FILE_CONTENT)
        return complete(undefined)
      } catch {
        return errored({ code: 'FAILED_TO_CREATE_SETTINGS_SCHEMA_FILE' })
      }
    }
    return errored({ code: 'FAILED_TO_READ_SETTINGS_SCHEMA_FILE' })
  }
}
async function generateSettingsTypes(rootDirAbsolute: string) {
  const hiddenDirectoryPath = path.join(rootDirAbsolute, HIDDEN_AUXX_DIRECTORY)
  const settingsTypesFilePath = path.join(hiddenDirectoryPath, SETTINGS_TYPES_FILENAME)
  try {
    await fs.mkdir(hiddenDirectoryPath, { recursive: true })
    await fs.writeFile(settingsTypesFilePath, SETTINGS_TYPES_FILE_CONTENT)
    return complete(undefined)
  } catch {
    return errored({ code: 'FAILED_TO_CREATE_SETTINGS_TYPES_FILE' })
  }
}
export async function generateSettingsFiles() {
  const rootDirAbsolute = path.resolve('.')
  const srcDirAbsolute = path.resolve('src')
  const results = await combineAsync([
    generateSettingsSchema(srcDirAbsolute),
    generateSettingsTypes(rootDirAbsolute),
  ])
  if (isErrored(results)) {
    return results
  }
  return complete(undefined)
}
