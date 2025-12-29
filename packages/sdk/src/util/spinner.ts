// packages/sdk/src/util/spinner.ts

import chalk from 'chalk'
import { isComplete, type Result } from '../errors.js'

/**
 * Sequence of Braille spinner frames rendered to emulate CLI progress motion.
 */
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Minimal terminal spinner that streams animated frames while asynchronous work
 * executes and provides helpers for success, warning, and error messaging.
 *
 * @example
 * ```ts
 * const spinner = new Spinner()
 * spinner.start('Fetching data')
 * // ... do work
 * spinner.success('Data ready')
 * ```
 */
class Spinner {
  frameIndex = 0
  stopped = false
  interval: NodeJS.Timeout | null = null

  message = ''

  /**
   * Begins animating the spinner with the supplied status message and returns
   * the instance to support method chaining.
   *
   * @param message Text displayed alongside the animated frame.
   * @returns The current `Spinner` instance for fluent usage.
   */
  start(message: string): Spinner {
    if (this.interval) {
      clearInterval(this.interval)
    }
    this.message = message
    this.stopped = false
    this.interval = setInterval(() => {
      if (this.stopped) return
      const frame = frames[(this.frameIndex = ++this.frameIndex % frames.length)]
      process.stdout.write(`\r${frame} ${this.message}`)
    }, 80)
    return this
  }

  /**
   * Updates the currently displayed status message without restarting the
   * animation.
   *
   * @param message Replacement text rendered on the next animation frame.
   * @returns The current `Spinner` instance for fluent usage.
   */
  update(message: string): Spinner {
    this.message = message
    return this
  }

  /**
   * Stops the spinner animation and optionally renders a terminal message with
   * carriage return cleanup for tidy output.
   *
   * @param message Optional final line written after halting the spinner.
   * @returns The current `Spinner` instance for fluent usage.
   */
  stop(message?: string): Spinner {
    this.stopped = true
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (message) {
      process.stdout.write(`\r${message}    \n`)
    }
    return this
  }

  /**
   * Stops the spinner and writes a green success indicator with the provided
   * message.
   *
   * @param message Completion text shown with a ✓ prefix.
   * @returns The current `Spinner` instance for fluent usage.
   */
  success(message: string): Spinner {
    return this.stop(`${chalk.green('✓')} ${message}`)
  }

  /**
   * Stops the spinner and writes a red error indicator with the provided
   * message.
   *
   * @param message Failure text shown with an ✖ prefix.
   * @returns The current `Spinner` instance for fluent usage.
   */
  error(message: string): Spinner {
    return this.stop(`${chalk.red('✖')} ${message}`)
  }

  /**
   * Stops the spinner and writes a yellow warning indicator with the provided
   * message.
   *
   * @param message Warning text shown with a ⚠ prefix.
   * @returns The current `Spinner` instance for fluent usage.
   */
  warning(message: string): Spinner {
    return this.stop(`${chalk.yellow('⚠')} ${message}`)
  }
}

/**
 * Executes an asynchronous function while displaying a spinner, then formats
 * completion output according to the resulting `Result` object.
 *
 * @param busyMessage Text to display while the spinner animates.
 * @param successMessage String or formatter function used when the result is complete.
 * @param fn Asynchronous action returning a `Result` shape to evaluate.
 * @returns Resolves with the `Result` provided by `fn`.
 *
 * @example
 * ```ts
 * const outcome = await spinnerify(
 *   'Connecting to service',
 *   (data: { id: string }) => `Connected as ${data.id}`,
 *   () => connectToRemoteService()
 * )
 *
 * if (!isComplete(outcome)) {
 *   console.error(outcome.error)
 * }
 * ```
 */
export async function spinnerify<T>(
  busyMessage: string,
  successMessage: string | ((value: T) => string),
  fn: () => Promise<Result<T, any>>
): Promise<Result<T, any>> {
  const spinner = new Spinner()
  spinner.start(busyMessage)
  try {
    const result = await fn()
    if (isComplete(result)) {
      spinner.success(
        typeof successMessage === 'string' ? successMessage : successMessage(result.value)
      )
    }
    return result
  } finally {
    spinner.stop()
  }
}
