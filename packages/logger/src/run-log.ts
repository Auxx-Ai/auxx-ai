// packages/logger/src/run-log.ts

import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import { _registerRunLogWriter, type RunLogEntryMeta } from './index'

export type RunLogFilter = (meta: RunLogEntryMeta) => boolean

interface RunLogContext {
  runKey: string
  stream: fs.WriteStream
  filter?: RunLogFilter
}

export interface WithRunLogOptions {
  /**
   * Optional predicate to decide whether a given log entry is written to the
   * run-log file. Domain-specific policy (which scopes/levels matter) lives at
   * the call site, not in the logger package.
   */
  filter?: RunLogFilter
}

const runLogStorage = new AsyncLocalStorage<RunLogContext>()

/** Strip ANSI escape codes from a string. */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

// Auto-register the file writer so all loggers pick it up
_registerRunLogWriter((message: string, meta: RunLogEntryMeta) => {
  const ctx = runLogStorage.getStore()
  if (!ctx) return
  if (ctx.filter && !ctx.filter(meta)) return
  try {
    ctx.stream.write(`${stripAnsi(message)}\n`)
  } catch {
    // Never let file write errors crash the workflow
  }
})

/**
 * Execute a function with all logger output teed to a file. Dev only.
 * All async work spawned inside `fn` inherits the log context automatically.
 *
 * Pass `options.filter` to limit which entries are written. The logger package
 * stays domain-blind; callers supply the policy.
 */
export function withRunLog<T>(
  runKey: string,
  filePath: string,
  fn: () => T,
  options?: WithRunLogOptions
): T {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const stream = fs.createWriteStream(filePath, { flags: 'a' })
  return runLogStorage.run({ runKey, stream, filter: options?.filter }, fn)
}

/** Close the current run's log stream. Safe to call when no run log is active. */
export function stopCurrentRunLog(): void {
  const ctx = runLogStorage.getStore()
  if (ctx) {
    ctx.stream.end()
  }
}
