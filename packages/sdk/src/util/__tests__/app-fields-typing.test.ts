// packages/sdk/src/util/__tests__/app-fields-typing.test.ts

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path
  .resolve(__dirname, '..', '..', '..', '__fixtures__', 'fields-app')
  .replace(/\\/g, '/')

/**
 * Compiles the `fields-app` fixture against its own tsconfig and returns the
 * diagnostics originating in the fixture's own files.
 */
function compileFixture(): string[] {
  const configPath = path.join(FIXTURE_DIR, 'tsconfig.json')
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  }
  // Parse with the fixture dir as the explicit base so `include` resolves to the
  // fixture regardless of the test runner's cwd.
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, FIXTURE_DIR)
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })

  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName.replace(/\\/g, '/').startsWith(FIXTURE_DIR))
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n')
      if (!d.file || d.start === undefined) {
        return message
      }
      const { line } = d.file.getLineAndCharacterOfPosition(d.start)
      return `${path.basename(d.file.fileName)}:${line + 1} — TS${d.code}: ${message}`
    })
}

/**
 * Type-level test for Layer 2 typed values. The fixture wires `fields` into an
 * unannotated `app` export, ships the generated `.auxx/app-fields.d.ts`
 * augmentation, and `consume.ts` exercises the narrowed value-I/O surface with
 * `@ts-expect-error` on every invalid call. The fixture must compile clean:
 *  - if narrowing FAILS, the invalid calls stop erroring → the unused
 *    `@ts-expect-error` becomes TS2578 → this test fails.
 *  - if a return type WIDENS, the exact-type assignment assertions error → fails.
 *
 * Verified non-vacuous: deleting the augmentation file makes this test fail with
 * TS2578 (unused @ts-expect-error) + TS2322 (FieldValueOut not assignable).
 */
describe('app-fields typed value I/O (Layer 2)', () => {
  it('narrows setFieldValues/getFieldValue to the app declared fields', () => {
    expect(compileFixture()).toEqual([])
  })
})
