// packages/sdk/src/util/error-reporting.ts

import { codeFrameColumns } from '@babel/code-frame'
import chalk from 'chalk'
import type { Message } from 'esbuild'
import { readFile } from 'fs/promises'

/**
 * Renders a TypeScript diagnostic to STDERR with a syntax-highlighted code
 * frame when the source file can be read successfully. Falls back to a concise
 * message when the file read fails.
 *
 * @param error Diagnostic metadata describing the TS issue.
 * @returns A promise that resolves once the diagnostic is written.
 *
 * @example
 * ```ts
 * await printTsError({
 *   file: 'src/main.ts',
 *   line: 12,
 *   column: 5,
 *   message: 'Cannot find name "user".',
 *   code: 2304,
 * })
 * ```
 */
export async function printTsError(error: {
  file: string
  line: number
  column: number
  message: string
  code: number
}): Promise<void> {
  try {
    const fileContent = await readFile(error.file, 'utf-8')

    const frame = codeFrameColumns(
      fileContent,
      {
        start: { line: error.line, column: error.column },
      },
      {
        highlightCode: true,
        message: error.message,
      }
    )

    process.stderr.write(
      `\n${chalk.red('✖')} ${chalk.bold(error.file)}:${error.line}:${error.column}\n`
    )
    process.stderr.write(`  ${chalk.gray(`TS${error.code}`)} ${error.message}\n`)
    process.stderr.write(`\n${frame}\n\n`)
  } catch {
    // Fallback if file can't be read
    process.stderr.write(`\n${chalk.red('✖')} ${error.file}:${error.line}:${error.column}\n`)
    process.stderr.write(`  ${chalk.gray(`TS${error.code}`)} ${error.message}\n\n`)
  }
}

/**
 * Writes an esbuild error or warning to STDERR with contextual location data
 * and supplementary notes where available.
 *
 * @param error Esbuild message payload describing the issue.
 * @param type String indicating whether the message represents an error or warning.
 *
 * @example
 * ```ts
 * printJsError(
 *   {
 *     text: 'Unexpected token',
 *     location: { file: 'src/app.tsx', line: 3, column: 15, lineText: 'const x =' },
 *     notes: [],
 *   },
 *   'error'
 * )
 * ```
 */
export function printJsError(error: Message, type: 'error' | 'warning'): void {
  const symbol = type === 'error' ? chalk.red('✖') : chalk.yellow('⚠')

  if (error.location) {
    const { file, line, column } = error.location
    process.stderr.write(`\n${symbol} ${chalk.bold(file)}:${line}:${column}\n`)

    if (error.location.lineText) {
      process.stderr.write(`  ${chalk.gray(error.location.lineText)}\n`)
    }
  } else {
    process.stderr.write(`\n${symbol} Build ${type}\n`)
  }

  process.stderr.write(`  ${error.text}\n`)

  if (error.notes && error.notes.length > 0) {
    for (const note of error.notes) {
      process.stderr.write(`  ${chalk.gray('ℹ')} ${note.text}\n`)
    }
  }

  process.stderr.write('\n')
}

/**
 * Summarizes a completed build in the terminal, reporting output path, bundle
 * size, and duration.
 *
 * @param result Object containing build result details.
 *
 * @example
 * ```ts
 * printBuildSummary({ outfile: 'dist/index.js', size: 20480, duration: 143 })
 * ```
 */
export function printBuildSummary(result: {
  outfile: string
  size: number
  duration: number
}): void {
  const sizeKb = (result.size / 1024).toFixed(2)
  const durationMs = result.duration

  process.stdout.write('\n')
  process.stdout.write(chalk.green('✓') + ' Build completed successfully\n\n')
  process.stdout.write(`  ${chalk.dim('Output:')} ${result.outfile}\n`)
  process.stdout.write(`  ${chalk.dim('Size:')} ${sizeKb} KB\n`)
  process.stdout.write(`  ${chalk.dim('Time:')} ${durationMs}ms\n`)
  process.stdout.write('\n')
}
