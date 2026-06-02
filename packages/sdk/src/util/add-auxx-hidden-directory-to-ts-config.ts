import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { complete, errored, fromPromise, fromThrowable, isErrored } from '../errors.js'

const tsconfigSchema = z
  .object({
    include: z.array(z.string()),
  })
  .passthrough()

/**
 * Recursive include glob for the hidden `.auxx` dir. A bare `.auxx` entry in
 * `include` does NOT load the directory's contents — TypeScript skips
 * dot-prefixed directories during include expansion, so the generated `.d.ts`
 * augmentations under `.auxx` would silently never reach the program. The
 * explicit recursive glob is required for them to be type-checked.
 */
const AUXX_INCLUDE_GLOB = `${HIDDEN_AUXX_DIRECTORY}/**/*`

export async function addAuxxHiddenDirectoryToTsConfig() {
  const tsconfigPath = path.resolve('./tsconfig.json')
  const tsconfigContentResult = await fromPromise(fs.readFile(tsconfigPath, 'utf-8'))
  if (isErrored(tsconfigContentResult)) {
    const { error } = tsconfigContentResult
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return errored({ code: 'TS_CONFIG_NOT_FOUND' })
    }
    return errored({ code: 'FAILED_TO_READ_TSCONFIG' })
  }
  const tsconfigResult = fromThrowable(() =>
    tsconfigSchema.parse(JSON.parse(tsconfigContentResult.value))
  )
  if (isErrored(tsconfigResult)) {
    return errored({ code: 'FAILED_TO_PARSE_TSCONFIG' })
  }
  if (tsconfigResult.value.include.includes(AUXX_INCLUDE_GLOB)) {
    return complete(false)
  }
  // Drop any legacy bare `.auxx` entry (which never loaded the dir) and add the
  // working glob instead.
  const updatedTsconfig = {
    ...tsconfigResult.value,
    include: [
      ...tsconfigResult.value.include.filter((entry) => entry !== HIDDEN_AUXX_DIRECTORY),
      AUXX_INCLUDE_GLOB,
    ],
  }
  const writeResult = await fromPromise(
    fs.writeFile(tsconfigPath, JSON.stringify(updatedTsconfig, null, 2))
  )
  if (isErrored(writeResult)) {
    return errored({ code: 'FAILED_TO_WRITE_TSCONFIG' })
  }
  return complete(true)
}
