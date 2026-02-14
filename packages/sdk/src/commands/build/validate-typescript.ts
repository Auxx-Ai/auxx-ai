// // packages/sdk/src/commands/build/validate-typescript.ts

import path from 'path'
import type { default as ts } from 'typescript'
import { complete, errored } from '../../errors.js'
import { getDiagnostics, readConfig, typeScriptErrorSchema } from '../../util/typescript.js'

export async function validateTypeScript() {
  try {
    const program = await readConfig(path.resolve('tsconfig.json'))
    if (program === 'Not a TypeScript project') {
      return complete(true)
    }
    const pro = program as ts.Program
    const errors = await getDiagnostics(pro)
    if (errors.length) {
      return errored({ code: 'VALIDATE_TYPE_SCRIPT_ERROR', errors })
    }
    return complete(true)
  } catch (error) {
    if (error instanceof Error) {
      const tsError = typeScriptErrorSchema.parse({ text: error.message })
      return errored({ code: 'VALIDATE_TYPE_SCRIPT_ERROR', errors: [tsError] })
    }
    return errored({ code: 'FILE_SYSTEM_ERROR', error })
  }
}
