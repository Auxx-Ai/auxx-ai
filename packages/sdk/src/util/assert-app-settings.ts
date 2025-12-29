import fs from 'fs/promises'
import path from 'path'
import { complete, errored, fromPromise, isErrored } from '../errors.js'
import { APP_SETTINGS_FILENAME } from '../constants/settings-files.js'

export async function assertAppSettings() {
  const srcDirAbsolute = path.resolve('src')
  const appSettingsPath = path.join(srcDirAbsolute, APP_SETTINGS_FILENAME)
  const readResult = await fromPromise(fs.readFile(appSettingsPath))
  if (isErrored(readResult)) {
    return errored({ code: 'APP_SETTINGS_NOT_FOUND' })
  }
  return complete(undefined)
}
