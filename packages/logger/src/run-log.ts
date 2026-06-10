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

const WORKSPACE_MARKER = 'pnpm-workspace.yaml'
let cachedRunLogRoot: string | undefined

/**
 * Resolve the directory that hosts the shared `.logs` folder, then join the
 * given segments onto `<root>/.logs`. Walks up from cwd to the monorepo root
 * (the dir holding `pnpm-workspace.yaml`) so run-log files from every app
 * (web, worker, …) land in ONE place — a single root-level `.logs` — instead of
 * a per-app `.logs` under each process's cwd. Falls back to cwd when the marker
 * isn't found (e.g. a standalone deploy). Cached per process; the root is fixed.
 */
export function runLogPath(...segments: string[]): string {
  if (cachedRunLogRoot === undefined) {
    let dir = process.cwd()
    cachedRunLogRoot = dir
    while (true) {
      if (fs.existsSync(path.join(dir, WORKSPACE_MARKER))) {
        cachedRunLogRoot = dir
        break
      }
      const parent = path.dirname(dir)
      if (parent === dir) break // hit fs root → keep cwd fallback
      dir = parent
    }
  }
  return path.join(cachedRunLogRoot, '.logs', ...segments)
}

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
