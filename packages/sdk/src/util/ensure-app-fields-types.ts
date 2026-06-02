// packages/sdk/src/util/ensure-app-fields-types.ts

import chalk from 'chalk'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { isErrored } from '../errors.js'
import { addAuxxHiddenDirectoryToTsConfig } from './add-auxx-hidden-directory-to-ts-config.js'
import { generateAppFieldsTypes } from './generate-app-fields-types.js'
import { isAppExportTypeAnnotated } from './warn-if-app-type-annotated.js'

/**
 * Generates `.auxx/app-fields.d.ts` (Layer 2 typed values), makes sure the
 * hidden `.auxx` directory is on the app's `tsconfig.include`, and warns when
 * the entry's `app` export is `: App`-annotated (which silently erases the field
 * literals the augmentation depends on).
 *
 * All failures are non-fatal: a missing/stale augmentation only degrades the
 * value-I/O signatures to permissive, it never blocks build or dev. Warnings go
 * to stderr. Safe to call alongside the settings generator — the tsconfig update
 * is idempotent.
 */
export async function ensureAppFieldsTypes(): Promise<void> {
  if (await isAppExportTypeAnnotated()) {
    process.stderr.write(
      chalk.yellow(
        '⚠ Your `app` export is annotated `: App`, which erases field literals — ' +
          'typed value I/O (@auxx/sdk/server) will fall back to permissive types. ' +
          'Use `satisfies App` (or no annotation) to keep `setFieldValues`/`getFieldValue` narrowed.\n'
      )
    )
  }

  const tsconfigResult = await addAuxxHiddenDirectoryToTsConfig()
  if (isErrored(tsconfigResult)) {
    process.stderr.write(
      chalk.yellow(
        `⚠ Could not add the ${HIDDEN_AUXX_DIRECTORY} directory to tsconfig "include". ` +
          'Typed field values may not be picked up.\n'
      )
    )
  }

  const generateResult = await generateAppFieldsTypes()
  if (isErrored(generateResult)) {
    process.stderr.write(
      chalk.yellow(
        `⚠ Could not generate .auxx/app-fields.d.ts at ${generateResult.error.path}. ` +
          'Field value I/O will use permissive types.\n'
      )
    )
  } else if (generateResult.value === 'skipped_unmanaged') {
    process.stderr.write(
      chalk.yellow(
        '⚠ Skipping .auxx/app-fields.d.ts generation because the existing file is unmanaged.\n'
      )
    )
  }
}
