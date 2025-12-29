// packages/sdk/src/util/print-message.ts

/**
 * Print a message to stdout
 * @param message - The message to display
 */
export function printMessage(message: string): void {
  process.stdout.write(`${message}\n`)
}
