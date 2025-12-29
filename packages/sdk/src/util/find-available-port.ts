// packages/sdk/src/util/find-available-port.ts

import { createServer } from 'net'

/**
 * Find an available port within a range
 * @param startPort - Starting port number
 * @param endPort - Ending port number
 * @returns Promise resolving to an available port number
 */
export async function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(`No available ports between ${startPort} and ${endPort}`)
}

/**
 * Check if a specific port is available
 * @param port - Port number to check
 * @returns Promise resolving to true if port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close()
      resolve(true)
    })

    // Try to bind to localhost specifically to detect conflicts with localhost-only servers
    server.listen(port, 'localhost')
  })
}
