/**
 * Cleanup function to stop listening for key presses
 */
type CleanupFunction = () => void

/**
 * Listens for a specific key press in the terminal
 * @param targetKey - The key to listen for (case-insensitive)
 * @param onKeyPress - Callback function to execute when the target key is pressed
 * @returns Cleanup function to remove the listener and restore stdin state
 */
export function listenForKey(targetKey: string, onKeyPress: () => void): CleanupFunction {
  let cleanupFunction: CleanupFunction

  function handleKeyPress(data: Buffer): void {
    const rawKey = data.toString()
    const key = rawKey.trim().toLowerCase()

    // Handle Ctrl+C - emit SIGINT to trigger cleanup handlers
    if (rawKey === '\u0003') {
      process.emit('SIGINT', 'SIGINT')
      return
    }

    if (key === targetKey.toLowerCase()) {
      onKeyPress()
    }
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', handleKeyPress)
  }

  cleanupFunction = () => {
    if (process.stdin.isTTY) {
      process.stdin.removeListener('data', handleKeyPress)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
  }

  return cleanupFunction
}
