// packages/logger/src/index.ts

// ---------------------------------------------------------------------------
// Run-scoped file sink hook (set by @auxx/logger/run-log on import)
// ---------------------------------------------------------------------------

export interface RunLogEntryMeta {
  scope: string
  level: LogLevel
}

type WriteToRunLogFn = (message: string, meta: RunLogEntryMeta) => void

let _writeToRunLog: WriteToRunLogFn | undefined

/**
 * Register the run-log writer. Called by `@auxx/logger/run-log` on import.
 * Keeps the main entry point free of Node.js imports (browser-safe).
 */
export function _registerRunLogWriter(fn: WriteToRunLogFn): void {
  _writeToRunLog = fn
}

function writeToRunLog(message: string, meta: RunLogEntryMeta): void {
  _writeToRunLog?.(message, meta)
}

// ---------------------------------------------------------------------------

/** Log levels supported by the scoped logger helpers. */
type LogLevel = 'info' | 'error' | 'warn' | 'trace' | 'debug'

/** Friendly color names that map to ANSI escape codes. */
type ColorName =
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'cyan'
  | 'magenta'
  | 'white'
  | 'black'
  | 'brightRed'
  | 'brightGreen'
  | 'brightBlue'
  | 'brightYellow'
  | 'brightCyan'
  | 'brightMagenta'
  | 'brightWhite'
  | 'brightBlack'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'

/** Shape of the scoped logger returned by createScopedLogger. */
export interface Logger {
  info: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  trace: (message: string, ...args: unknown[]) => void
  with: (newFields: Record<string, unknown>) => Logger
}

/** ANSI color codes keyed by log level for console output. */
const colors = {
  // info: '\x1b[0m', // white
  info: '\x1b[34m', // blue
  debug: '\x1b[36m', // cyan
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  trace: '\x1b[36m', // cyan
  reset: '\x1b[0m',
} as const

/** ANSI color codes keyed by friendly color names. */
const namedColors = {
  // Basic colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  black: '\x1b[30m',

  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightBlue: '\x1b[94m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  brightMagenta: '\x1b[95m',
  brightWhite: '\x1b[97m',
  brightBlack: '\x1b[90m',

  // Semantic colors
  success: '\x1b[92m', // bright green
  warning: '\x1b[93m', // bright yellow
  danger: '\x1b[91m', // bright red
  info: '\x1b[94m', // bright blue
  muted: '\x1b[90m', // bright black (gray)

  reset: '\x1b[0m',
} as const

/** Placeholder string used when large payload fields are intentionally omitted from logs. */
const OMITTED_FIELD_PLACEHOLDER = '[omitted]'

/** Placeholder string applied when sensitive values are redacted from logs. */
const REDACTED_FIELD_PLACEHOLDER = '[redacted]'

/** Set of normalized field names that represent oversized payloads to omit from logs. */
const LARGE_PAYLOAD_FIELD_NAMES = new Set<string>(['texthtml'])

/** List of substrings that signal a field is sensitive and should be redacted. */
const SENSITIVE_FIELD_MARKERS = ['password', 'secret', 'token', 'apikey']

/** Maximum depth to traverse while sanitizing log arguments to avoid circular references. */
const MAX_SANITIZE_DEPTH = 4

/**
 * Recursively sanitizes a value destined for log output, stripping or summarizing large fields.
 */
function sanitizeLogValue(value: unknown, depth: number = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      const normalized = normalizeFieldName(key)
      if (isSensitiveField(normalized)) {
        return [key, REDACTED_FIELD_PLACEHOLDER]
      }
      if (LARGE_PAYLOAD_FIELD_NAMES.has(normalized) && typeof val === 'string') {
        return [key, `${OMITTED_FIELD_PLACEHOLDER} length=${val.length}`]
      }
      return [key, sanitizeLogValue(val, depth + 1)]
    })
    return Object.fromEntries(entries)
  }

  return String(value)
}

/** Normalizes object keys so comparisons ignore casing and separators. */
function normalizeFieldName(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/** Determines whether a normalized field name should always be redacted. */
function isSensitiveField(normalizedKey: string): boolean {
  return SENSITIVE_FIELD_MARKERS.some((marker) => normalizedKey.includes(marker))
}

/**
 * Creates a scoped logger that prefixes messages with a scope name and timestamp.
 */
export function createScopedLogger(scope: string, options?: { color?: ColorName }): Logger {
  // if (env.NEXT_PUBLIC_AXIOM_TOKEN) return createAxiomLogger(scope)

  const scopeColor = options?.color ? namedColors[options.color] : namedColors.info

  /**
   * Builds a logger with contextual fields that are appended to each message.
   */
  const createLogger = (fields: Record<string, unknown> = {}): Logger => {
    const formatMessage = (level: LogLevel, message: string, args: unknown[]) => {
      const allArgs = [...args]
      if (Object.keys(fields).length > 0) {
        allArgs.push(fields)
      }

      const formattedArgs = allArgs
        .map((arg) => sanitizeLogValue(arg))
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
        .join(' ')

      const nowDate = new Date()
      const now = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}:${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}:${String(nowDate.getSeconds()).padStart(2, '0')}`

      if (process.env.NODE_ENV === 'development') {
        const coloredScope = `${scopeColor}[${now}][${scope}]${namedColors.reset}`
        const coloredMessage = `${colors[level]}${message} ${formattedArgs}${colors.reset}`
        return `${coloredScope}: ${coloredMessage}`
      }

      const msg = `[${now}][${scope}]: ${message} ${formattedArgs}`
      return msg
    }

    const logAndWrite = (
      consoleFn: (...args: unknown[]) => void,
      level: LogLevel,
      message: string,
      args: unknown[]
    ) => {
      const formatted = formatMessage(level, message, args)
      consoleFn(formatted)
      writeToRunLog(formatted, { scope, level })
    }

    return {
      info: (message: string, ...args: unknown[]) =>
        logAndWrite(console.log, 'info', message, args),
      debug: (message: string, ...args: unknown[]) =>
        logAndWrite(console.debug, 'debug', message, args),
      error: (message: string, ...args: unknown[]) =>
        logAndWrite(console.error, 'error', message, args),
      warn: (message: string, ...args: unknown[]) =>
        logAndWrite(console.warn, 'warn', message, args),
      trace: (message: string, ...args: unknown[]) => {
        if (process.env.NODE_ENV !== 'production') {
          logAndWrite(console.log, 'trace', message, args)
        }
      },
      with: (newFields: Record<string, unknown>) => createLogger({ ...fields, ...newFields }),
    }
  }

  return createLogger()
}

// function createAxiomLogger(scope: string) {
//   const createLogger = (fields: Record<string, unknown> = {}) => ({
//     info: (message: string, args?: Record<string, unknown>) =>
//       log.info(message, { scope, ...fields, ...args }),
//     debug: (message: string, args?: Record<string, unknown>) =>
//       log.debug(message, { scope, ...fields, ...args }),
//     error: (message: string, args?: Record<string, unknown>) =>
//       log.error(message, { scope, ...fields, ...args }),
//     warn: (message: string, args?: Record<string, unknown>) =>
//       log.warn(message, { scope, ...fields, ...args }),
//     trace: (message: string, args?: Record<string, unknown>) => {
//       if (process.env.NODE_ENV !== 'production') {
//         log.debug(message, { scope, ...fields, ...args })
//       }
//     },
//     with: (newFields: Record<string, unknown>) => createLogger({ ...fields, ...newFields }),
//   })

//   return createLogger()
// }
