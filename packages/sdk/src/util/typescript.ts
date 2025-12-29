// packages/sdk/src/util/typescript.ts

import { createReadStream, existsSync } from 'fs'
import { createInterface } from 'readline'
import chalk from 'chalk'
import { default as ts } from 'typescript'
import { z } from 'zod'
import { type JsError } from '../errors.js'

/**
 * Reads and returns the zero-indexed line content from the provided file path.
 * Falls back to `null` when the requested line is not present to allow callers to
 * distinguish between missing files and truncated diagnostics.
 *
 * @param path Absolute file system path to read from.
 * @param line Zero-based line index to retrieve (0 represents the first line).
 * @returns Resolves with the matching line contents or `null` when unavailable.
 */
async function readLine(path: string, line: number): Promise<string | null> {
  const stream = createReadStream(path)
  const readlineInterface = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })
  let currentLine = 0
  for await (const lineText of readlineInterface) {
    currentLine += 1
    if (currentLine === line + 1) {
      readlineInterface.close()
      stream.close()
      return lineText
    }
  }
  return null
}

/**
 * Shared formatter injected into the TypeScript compiler API so diagnostics
 * consistently resolve canonical file names, working directory, and newline
 * sequences regardless of the host environment.
 */
const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (path: string) => path,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => '\n',
}

/**
 * Zod schema validating structured TypeScript compiler errors with optional
 * location metadata, enabling strict parsing of compiler output regardless of
 * the origin (TypeScript program or string fallback).
 */
export const typeScriptErrorSchema = z.object({
  text: z.string(),
  location: z
    .object({
      file: z.string(),
      lineText: z.string(),
      line: z.number(),
      character: z.number(),
      endCharacter: z.number(),
    })
    .optional(),
})

/**
 * Strongly-typed representation of the compiler error payload produced by
 * `typeScriptErrorSchema`, used across diagnostics and user-facing printers.
 */
export type TypeScriptError = z.infer<typeof typeScriptErrorSchema>
/**
 * Hydrates a TypeScript `Program` using the provided `tsconfig` path, or returns
 * a string note when the path does not exist. Errors emitted while parsing the
 * config are normalized through `typeScriptErrorSchema` for consistent handling.
 *
 * @param configFile Absolute or relative filesystem path to the `tsconfig` JSON.
 * @returns A compiled `ts.Program` ready for diagnostics or a string message when no config exists.
 * @throws {TypeScriptError} When the config file cannot be parsed by the compiler API.
 */
export const readConfig = async (configFile: string): Promise<ts.Program | string> =>
  new Promise((resolve, reject) => {
    if (!existsSync(configFile)) {
      resolve('Not a TypeScript project')
      return
    }
    const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile)
    if (error) {
      reject(typeScriptErrorSchema.parse({ text: ts.formatDiagnostic(error, formatHost) }))
    } else {
      const parsedCommandLine = ts.parseJsonConfigFileContent(config, ts.sys, './')
      resolve(
        ts.createProgram({
          rootNames: parsedCommandLine.fileNames,
          options: parsedCommandLine.options,
        })
      )
    }
  })

/**
 * Collects and formats synchronous TypeScript diagnostics from the supplied
 * program, enriching them with source line excerpts to improve CLI error
 * readability.
 *
 * @param program TypeScript program instance created by `ts.createProgram`.
 * @returns A list of normalized `TypeScriptError` objects describing diagnostics.
 */
export const getDiagnostics = async (program: ts.Program): Promise<TypeScriptError[]> => {
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const errors = await Promise.all(
    diagnostics.map(async (diagnostic) => {
      const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      if (diagnostic.file && diagnostic.start !== undefined && diagnostic.length !== undefined) {
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        const endPosition = diagnostic.start + diagnostic.length
        const { character: endCharacter } =
          diagnostic.file.getLineAndCharacterOfPosition(endPosition)
        const lineText = await readLine(diagnostic.file.fileName, line)
        return typeScriptErrorSchema.parse({
          text,
          location: {
            file: diagnostic.file.fileName,
            line,
            character,
            endCharacter,
            lineText,
          },
        })
      } else {
        return typeScriptErrorSchema.parse({ text })
      }
    })
  )
  return errors
}

/**
 * Writes a colorized, human-friendly representation of a TypeScript diagnostic
 * to STDERR, highlighting the offending source span and file metadata to mirror
 * IDE output in terminal contexts.
 *
 * @param error Normalized TypeScript diagnostic to render.
 */
export function printTsError(error: TypeScriptError): void {
  if (!error.location) {
    process.stderr.write(`${chalk.red('×')} – ${error.text}\n`)
    return
  }
  const lineString = error.location.line.toLocaleString().padStart(3, ' ')
  const lineStringLength = lineString.length
  const emptyLine = ' '.repeat(lineStringLength)
  const lineText = error.location.lineText
  const leadingSpaces = lineText.match(/^\s*/)?.[0].length || 0
  const trimmedLineText = lineText.trimStart()
  const beforeError = trimmedLineText.slice(0, error.location.character - leadingSpaces)
  const errorText = trimmedLineText.slice(
    error.location.character - leadingSpaces,
    error.location.endCharacter - leadingSpaces
  )
  const afterError = trimmedLineText.slice(error.location.endCharacter - leadingSpaces)
  process.stderr.write(`${' '.repeat(lineStringLength - 2)} ${chalk.red('×')} ${error.text}\n\n`)
  process.stderr.write(`${emptyLine} ╭─── ${chalk.bold(error.location.file)}\n`)
  process.stderr.write(`${lineString} │ ${beforeError}${chalk.red(errorText)}${afterError}\n`)
  process.stderr.write(
    `${emptyLine} │ ${' '.repeat(Math.max(0, error.location.character - leadingSpaces))}${chalk.red('~'.repeat(Math.max(0, error.location.endCharacter - error.location.character)))}\n`
  )
  process.stderr.write(`${emptyLine} ╰───\n\n`)
}

/**
 * Writes rich terminal output for JavaScript build errors that conform to the
 * shared `JsError` contract, supporting both error and warning severities while
 * aligning formatting with the TypeScript printer for consistency.
 *
 * @param error Normalized JavaScript or bundler error describing the failure.
 * @param type Severity indicator used to switch rendering treatment between errors and warnings.
 */
export function printJsError(error: JsError, type: 'error' | 'warning'): void {
  if (!error.location) {
    process.stderr.write(`${chalk.red('×')} – ${error.text}\n`)
    return
  }
  const lineString = error.location.line.toLocaleString().padStart(3, ' ')
  const lineStringLength = lineString.length
  const emptyLine = ' '.repeat(lineStringLength)
  const lineText = error.location.lineText
  const leadingSpaces = lineText.match(/^\s*/)?.[0].length || 0
  const trimmedLineText = lineText.trimStart()
  const beforeError = trimmedLineText.slice(0, error.location.column - leadingSpaces)
  const errorText = trimmedLineText.slice(
    error.location.column - leadingSpaces,
    error.location.column + error.location.length - leadingSpaces
  )
  const afterError = trimmedLineText.slice(
    error.location.column + error.location.length - leadingSpaces
  )
  process.stderr.write(
    `${' '.repeat(lineStringLength - 2)} ${type === 'error' ? chalk.red('×') : '🚧'} ${error.text}\n\n`
  )
  process.stderr.write(`${emptyLine} ╭─── ${chalk.bold(error.location.file)}\n`)
  process.stderr.write(`${lineString} │ ${beforeError}${chalk.red(errorText)}${afterError}\n`)
  process.stderr.write(
    `${emptyLine} │ ${' '.repeat(Math.max(0, error.location.column - leadingSpaces))}${chalk.red('~'.repeat(error.location.length))}\n`
  )
  process.stderr.write(`${emptyLine} ╰───\n\n`)
}
