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
  if (tsconfigResult.value.include.includes(HIDDEN_AUXX_DIRECTORY)) {
    return complete(false)
  }
  const updatedTsconfig = {
    ...tsconfigResult.value,
    include: [...tsconfigResult.value.include, HIDDEN_AUXX_DIRECTORY],
  }
  const writeResult = await fromPromise(
    fs.writeFile(tsconfigPath, JSON.stringify(updatedTsconfig, null, 2))
  )
  if (isErrored(writeResult)) {
    return errored({ code: 'FAILED_TO_WRITE_TSCONFIG' })
  }
  return complete(true)
}
