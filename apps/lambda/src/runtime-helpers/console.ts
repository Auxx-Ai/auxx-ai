// apps/lambda/src/runtime-helpers/console.ts

/**
 * Console logging functionality for Lambda runtime
 *
 * Provides console interception to capture logs during extension execution
 * and serialize them for storage and display in the platform.
 *
 * @module runtime-helpers/console
 *
 * @example
 * ```typescript
 * import { interceptConsole, getCapturedLogs, restoreConsole, clearCapturedLogs } from './console'
 *
 * // Before executing extension code
 * clearCapturedLogs()
 * interceptConsole()
 *
 * // Extension code runs and logs are captured
 * console.log('Hello from extension')
 * console.warn('Warning message')
 * console.error('Error occurred')
 *
 * // After execution
 * const logs = getCapturedLogs()
 * restoreConsole()
 *
 * // logs = [
 * //   { level: 'log', message: 'Hello from extension', args: [...], timestamp: 1234567890 },
 * //   { level: 'warn', message: 'Warning message', args: [...], timestamp: 1234567891 },
 * //   { level: 'error', message: 'Error occurred', args: [...], timestamp: 1234567892 }
 * // ]
 * ```
 */

/**
 * Console log entry captured during execution
 *
 * @interface ConsoleLog
 * @property {('log'|'warn'|'error')} level - The severity level of the log
 * @property {string} message - Serialized message string (all args joined)
 * @property {unknown[]} args - Original arguments passed to console method (sanitized)
 * @property {number} timestamp - Unix timestamp in milliseconds when log was captured
 *
 * @example
 * ```typescript
 * const log: ConsoleLog = {
 *   level: 'log',
 *   message: 'User ID: 123',
 *   args: ['User ID:', 123],
 *   timestamp: 1699286400000
 * }
 * ```
 */
export interface ConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  args: unknown[]
  timestamp: number
}

/**
 * Captured console logs (module-level state)
 */
let capturedLogs: ConsoleLog[] = []

/**
 * Original console methods (stored before interception)
 */
let originalConsole: {
  log: typeof console.log
  warn: typeof console.warn
  error: typeof console.error
} | null = null

/**
 * Serialize console arguments to a single message string
 *
 * Converts various argument types (strings, numbers, objects, arrays) into a
 * single formatted string. Objects are JSON-stringified. Very long messages
 * are truncated to prevent memory issues.
 *
 * @param {unknown[]} args - Array of arguments passed to console method
 * @returns {string} Serialized message string (max 10,000 characters)
 *
 * @example
 * ```typescript
 * serializeArgs(['Hello', 'world']) // 'Hello world'
 * serializeArgs(['Count:', 42]) // 'Count: 42'
 * serializeArgs([{ id: 1, name: 'John' }]) // '{"id":1,"name":"John"}'
 * serializeArgs([null, undefined]) // 'null undefined'
 * ```
 */
function serializeArgs(args: unknown[]): string {
  const MAX_MESSAGE_LENGTH = 10000

  try {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
        if (arg === null) return 'null'
        if (arg === undefined) return 'undefined'
        // For objects/arrays, use JSON.stringify
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join(' ')

    // Truncate if too long
    return message.length > MAX_MESSAGE_LENGTH
      ? message.substring(0, MAX_MESSAGE_LENGTH) + '... [truncated]'
      : message
  } catch {
    return '[Error serializing arguments]'
  }
}

/**
 * Sanitize arguments for storage (handle circular refs, etc.)
 *
 * Removes circular references and ensures arguments can be safely stored.
 * Uses JSON.parse(JSON.stringify()) trick. If that fails, converts to strings.
 *
 * @param {unknown[]} args - Array of arguments to sanitize
 * @returns {unknown[]} Sanitized array safe for storage
 *
 * @example
 * ```typescript
 * // Simple values pass through
 * sanitizeArgs([1, 'hello', true]) // [1, 'hello', true]
 *
 * // Objects without circular refs are cloned
 * sanitizeArgs([{ name: 'John' }]) // [{ name: 'John' }]
 *
 * // Circular refs are handled
 * const obj: any = { name: 'John' }
 * obj.self = obj // circular reference
 * sanitizeArgs([obj]) // ['[object Object]'] - converted to string
 * ```
 */
function sanitizeArgs(args: unknown[]): unknown[] {
  try {
    // Use JSON parse/stringify to remove circular references
    return JSON.parse(JSON.stringify(args))
  } catch {
    // If serialization fails, convert to strings
    return args.map((arg) => {
      try {
        return String(arg)
      } catch {
        return '[Unserializable]'
      }
    })
  }
}

/**
 * Create console interceptor for a specific log level
 */
function createConsoleInterceptor(level: 'log' | 'warn' | 'error') {
  return (...args: unknown[]) => {
    // Capture the log
    try {
      const log: ConsoleLog = {
        level,
        message: serializeArgs(args),
        args: sanitizeArgs(args),
        timestamp: Date.now(),
      }
      capturedLogs.push(log)
    } catch (error) {
      // Don't let logging errors break execution
      // Use original console if available, otherwise just ignore
      if (originalConsole) {
        originalConsole.error('[RuntimeHelpers] Failed to capture log:', error)
      }
    }

    // Call original console method (for CloudWatch logs)
    if (originalConsole) {
      originalConsole[level](...args)
    }
  }
}

/**
 * Intercept console methods to capture logs
 *
 * Replaces console.log, console.warn, and console.error with interceptors that
 * capture all logs while still forwarding to the original console (for CloudWatch).
 *
 * IMPORTANT: Call this BEFORE executing extension code. Always pair with restoreConsole().
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * // Setup before extension execution
 * interceptConsole()
 *
 * // Extension code runs
 * console.log('This will be captured')
 *
 * // Cleanup after execution
 * const logs = getCapturedLogs()
 * restoreConsole()
 * ```
 */
export function interceptConsole(): void {
  // Guard against double-interception on concurrent requests.
  // If originalConsole is already set, console.log is already an interceptor —
  // overwriting originalConsole with it would cause infinite recursion.
  if (originalConsole) return

  // Store original console methods
  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  // Replace with interceptors
  console.log = createConsoleInterceptor('log')
  console.warn = createConsoleInterceptor('warn')
  console.error = createConsoleInterceptor('error')

  console.log('[RuntimeHelpers] Console interception enabled')
}

/**
 * Restore original console methods
 *
 * Puts back the original console.log, console.warn, and console.error methods,
 * stopping log capture. Safe to call multiple times.
 *
 * IMPORTANT: Call this AFTER execution to prevent leaking interceptors between runs.
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * interceptConsole()
 * // ... extension code runs ...
 * restoreConsole() // Restore original console
 *
 * // Subsequent console calls won't be captured
 * console.log('Not captured')
 * ```
 */
export function restoreConsole(): void {
  if (originalConsole) {
    console.log = originalConsole.log
    console.warn = originalConsole.warn
    console.error = originalConsole.error
    originalConsole = null
  }
}

/**
 * Get captured console logs
 *
 * Returns all console logs captured since the last clearCapturedLogs() call.
 * Each log includes level, serialized message, original args, and timestamp.
 *
 * @returns {ConsoleLog[]} Array of captured log entries
 *
 * @example
 * ```typescript
 * interceptConsole()
 * console.log('User logged in', { userId: 123 })
 * console.warn('Low memory')
 * console.error('Connection failed')
 *
 * const logs = getCapturedLogs()
 * console.log(logs)
 * // [
 * //   {
 * //     level: 'log',
 * //     message: 'User logged in {"userId":123}',
 * //     args: ['User logged in', { userId: 123 }],
 * //     timestamp: 1699286400000
 * //   },
 * //   {
 * //     level: 'warn',
 * //     message: 'Low memory',
 * //     args: ['Low memory'],
 * //     timestamp: 1699286401000
 * //   },
 * //   ...
 * // ]
 * ```
 */
export function getCapturedLogs(): ConsoleLog[] {
  return capturedLogs
}

/**
 * Clear captured console logs
 *
 * Resets the internal log buffer. Call this BEFORE starting a new execution
 * to ensure logs from previous runs don't leak into the new execution.
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * // Clear logs before new execution
 * clearCapturedLogs()
 * interceptConsole()
 *
 * // Extension code runs and logs
 * console.log('Hello')
 *
 * const logs = getCapturedLogs() // Only contains logs from current execution
 * restoreConsole()
 * ```
 */
export function clearCapturedLogs(): void {
  capturedLogs = []
}
