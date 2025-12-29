import { env } from '@auxx/config/server'

export type Logger = ReturnType<typeof createScopedLogger>

type LogLevel = 'info' | 'error' | 'warn' | 'trace' | 'debug'

const colors = {
  // info: '\x1b[0m', // white
  info: '\x1b[34m', // blue
  debug: '\x1b[36m', // cyan
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  trace: '\x1b[36m', // cyan
  reset: '\x1b[0m',
} as const

export function createScopedLogger(scope: string) {
  // if (env.NEXT_PUBLIC_AXIOM_TOKEN) return createAxiomLogger(scope)

  const createLogger = (fields: Record<string, unknown> = {}) => {
    const formatMessage = (level: LogLevel, message: string, args: unknown[]) => {
      const allArgs = [...args]
      if (Object.keys(fields).length > 0) {
        allArgs.push(fields)
      }

      const formattedArgs = allArgs
        .map((arg) =>
          typeof arg === 'object'
            ? JSON.stringify(
                arg,
                (key, value) => (typeof value === 'bigint' ? value.toString() : value),
                2
              )
            : String(arg)
        )
        .join(' ')

      const msg = `[${scope}]: ${message} ${formattedArgs}`

      if (process.env.NODE_ENV === 'development') return `${colors[level]}${msg}${colors.reset}`
      return msg
    }

    return {
      info: (message: string, ...args: unknown[]) =>
        console.log(formatMessage('info', message, args)),
      debug: (message: string, ...args: unknown[]) =>
        console.debug(formatMessage('info', message, args)),
      error: (message: string, ...args: unknown[]) =>
        console.error(formatMessage('error', message, args)),
      warn: (message: string, ...args: unknown[]) =>
        console.warn(formatMessage('warn', message, args)),
      trace: (message: string, ...args: unknown[]) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log(formatMessage('trace', message, args))
        }
      },
      with: (newFields: Record<string, unknown>) => createLogger({ ...fields, ...newFields }),
    }
  }

  return createLogger()
}
